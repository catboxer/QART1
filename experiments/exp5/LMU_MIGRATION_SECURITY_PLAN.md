# Study 2 (Exp5): securing the data when it moves from Google to LMU

Written 2026-11-13. Purpose: a checklist to work through when moving storage from
Google Firestore to LMU servers, so that the data is protected while it passes from the
participant's browser to LMU and once it is stored there. Items marked **[CHECK]** are
things I could not verify from the code and need an answer from LMU IT or from you.

---

## 1. Where things stand today (verified in the code, 2026-11-13)

- The browser writes **directly** to Google Firestore (Firebase project `qartexperiment1`)
  using the Firebase client library. There is no server of ours in between.
- Participants are signed in **anonymously** (`signInAnonymously`, `src/firebase.js`). Any
  visitor gets a "signed in" identity. The Firebase web key is in the page source (this is
  normal for Firebase, but it means rules are the only gate).
- Firestore security rules (`firestore.rules`, deliberately **not** in git) are the only
  access control. They cannot prove that data is genuine, only who may write where.
- Random numbers pass through Netlify functions (`quantis`, `qrng-race`) to the browser,
  which turns them into bits and saves them itself. Netlify also sees participants' IP
  addresses as the host.
- Payment-related secrets: `PAYMENT_CODE_SECRET` (Netlify env var), `QUANTIS_API_KEY`.
- **The consent text says the data is stored on an LMU server. Today it is stored at Google.
  Do not collect real participant data until storage is at LMU, or the text is corrected.**
  **[CHECK]** Firestore region: Firebase console > Project settings > Default GCP resource location.

### Data in the database today (Exp5)

| Collection | Contents | Sensitivity |
|---|---|---|
| `experiment5_responses` (+ subcollections `minutes`, `block_commits`, `audits`) | One document per session: results, raw random bits, timings, recruitment source, session number | Research data (pseudonymous) |
| `experiment5_participants` | One per participant key (hash of email or Prolific ID): session counter, questionnaire flag, payment-requested flag, aliases | Pseudonymous, but identifies a person to anyone who knows their email |
| `experiment5_email_lookup` | **Plaintext email or Prolific ID**, payment code (`tremendous_token`), contact opt-ins | **Directly identifying. Highest sensitivity.** |
| `experiment5_prolific_sessions` | One per Prolific SESSION_ID (claims a link) | Pseudonymous |
| `experiment5_payment_codes` | One per payment code, bound to a participant key | Pseudonymous |
| `participants/{uid}` | Pre-questionnaire answers (demographics, beliefs, scales), keyed by anonymous browser ID, with participant key | Special-category-adjacent (beliefs, neurodivergence, experiences). **Sensitive.** |

## 2. The main design change: put a server between the browser and the database

At Google, the rules guard each write. At LMU, **do not let the browser reach the database
at all.** Run a small API on an LMU-controlled server. The browser sends data to the API
over HTTPS; the API validates it and writes to the database with its own credentials.

```
Browser  --HTTPS-->  LMU API (validates, rate-limits, signs)  -->  LMU database
                           |
                           +-->  Quantis (random numbers; server-side only)
```

Why: a script that copies the web key can currently talk to Firestore directly. With an
API, the only door is one you control and can inspect.

### What the API should enforce (these are rules/limits in Firestore today)

| Today (Firestore rules / browser code) | At LMU (server or database constraint) |
|---|---|
| Session created only by its own anonymous user | Server creates the session ID; the browser never chooses it |
| Prolific SESSION_ID can claim once (create-once document) | `UNIQUE` constraint on the session ID; insert fails if it exists |
| Payment code bound to one participant (create-once document) | `UNIQUE` constraint on the code; check the stored participant matches |
| Code is genuine (HMAC check in a Netlify function) | Same HMAC check, inside the API. Secret stays on the server only |
| Session counter: whole number 0-5; questionnaire and payment-requested flags can only be set, not cleared | Server increments the counter itself; flags written by the server only, never settable to "false" |
| No edits to a completed session | Reject any write to a session whose `completed` is true |
| Profile / lookup only readable by admins | Database roles: the app login can insert/update, **cannot** read the lookup table |
| Netlify Forms alert for payment requests | Server sends the email alert itself (or a message to a queue) |

Also move **all** of these to the server: the random-number fetch from Quantis, the
signing of those bytes (see 4), the session-number logic (profile counter vs Prolific
`WAVE`), and the "participation ended after payment request" check.

## 3. Protecting the data in transit (browser to LMU)

- HTTPS only, TLS 1.2 or newer, valid certificate (LMU-managed if possible). Redirect all
  HTTP to HTTPS and send an HSTS header.
- The API accepts requests only from your study's own web address (strict CORS), and rejects
  everything else. Do not use a wildcard origin (the current Netlify functions use `*`).
- Never put personal data in a URL (it ends up in logs). Use POST bodies. Today the payment
  code is in the URL by design; treat it as a secret-ish token and keep it out of server logs
  where possible (log a hash, not the code).
- Send security headers on the website: `Content-Security-Policy` (only your own scripts),
  `X-Content-Type-Options`, `Referrer-Policy: no-referrer` (so a payment code in the URL is
  not passed to other sites), frame blocking.
- Keep the existing in-page checks (frozen `fetch`/`crypto`) but do not rely on them: they run
  in the participant's browser, which an attacker controls.

## 4. Making sure the data is genuine (integrity)

Because the browser currently computes and writes the results, a forged session is
indistinguishable from a real one. At LMU:

1. **The server fetches the random bytes** from Quantis and returns them with a signature
   (HMAC-SHA256 over: source, byte count, issued-at time, one-time nonce, session ID, block
   number, and the bytes). The browser stores the signature with each block.
2. **In the analysis**, recompute every signature with the same secret (kept as a Colab secret,
   never in a notebook or CSV). Exclude blocks that fail. Check timing between blocks against
   the minimum the app allows. Treat any data collected before signing existed as unverified.
3. **Limit fetches** per session and per IP; refuse extra requests. Log each issued block so
   fetched-but-unused blocks (cherry-picking) are visible.
4. Keep the provider recorded per block (`quantis` or `lfdr`). The Quantis-to-LFDR fallback
   exists today (`fallback=lfdr` in `fetchQRNGBits.js`). Decide whether it stays: the consent
   text says the generator is hosted at LMU.

## 5. Protecting the data at rest (stored at LMU)

- Encrypt the database disk and all backups. **[CHECK]** with LMU IT what they provide.
- **Split the storage**: keep the identifying table (emails, Prolific IDs, payment codes,
  opt-ins) in a **separate database or schema** from the research data, with separate
  credentials. The research-data login must not be able to read the identifying table.
- Least privilege: the API's database account can insert and update only what it needs, cannot
  drop tables, and cannot read the identifying table unless the feature needs it.
- Questionnaire answers (`participants/{uid}`) are the most sensitive research content. Keep
  them keyed by the pseudonymous participant key, not by an identifier, and store them in the
  research database, not in the identifying one.
- Automate retention: a scheduled job that deletes the linkage/identifying table no later than
  **30 December 2028**, as the consent form promises, and logs that it ran. After that the
  research data are anonymous and individual deletion is no longer possible.
- Backups: encrypted, access-controlled, restore-tested, and included in the deletion
  schedule (a backup that still holds the linkage table breaks the promise above).

## 6. Access control and monitoring

- Multi-factor sign-in for every account that can reach the server or database. Keep the admin
  list short. Restrict admin access to the LMU network or a VPN where possible.
- **Replace the admin check in Firestore** (admins are the emails listed in `admin/qa`; anyone
  who can edit that document can add themselves) with proper accounts on the LMU system.
- Keep audit logs: who read the identifying table, when, and why. Alert on unusual volumes of
  requests, many new participants from one IP, or many failed code checks.
- Rotate secrets (`PAYMENT_CODE_SECRET`, signing secret, Quantis key) on a schedule and after
  any suspected exposure. Changing `PAYMENT_CODE_SECRET` invalidates every issued code, so
  plan that carefully.
- Treat `payment-codes*.csv` (your list of who may be paid) as confidential. It is in
  `.gitignore`. Keep it on an encrypted disk or LMU storage, not in email.

## 7. Abuse and fraud

- **Rate limits** per IP and per participant key on every endpoint, including the code check.
- **Pay by hand after review.** Check completed sessions, timing and duplicate patterns before
  releasing any payment. This remains the main protection against fake participants.
- Consider verifying each email address (a confirmation link) for paid participants.
- Add bot protection (a CAPTCHA or similar) on the consent step if abuse appears.

## 8. Migration steps (order matters)

1. Agree the architecture with LMU IT and the data-protection contact (questions in section 11).
2. In the code, gather every database call into **one module** so the switch changes one place.
   Today they are spread across: `hooks/useParticipantProfile.js`, `hooks/useSessionPersistence.js`,
   `hooks/useTrialRunner.js` (minutes, block_commits, audits), `lib/paymentCodeClaim.js`,
   `lib/paymentRequest.js`, `lib/prolificSessionClaim.js`, `lib/sessionHistory.js`, and
   `MainApp.jsx` (questionnaire answers and completion).
3. Build the API and the database; add the constraints from section 2; write tests that try
   to break each one (duplicate session ID, reused code, wrong participant, edited counter,
   write after completion).
4. Add signing (section 4) and the verification step in the analysis notebook.
5. Test end to end on a staging copy with fake participants. Include a failed-write case
   (what the participant sees if the server is down).
6. Export existing Firestore data (test data only, if possible). Compare counts and hashes.
   Record the snapshot date and file hashes with the analysis notes.
7. Switch the app to the API. Keep Firestore **read-only** briefly as a safety net, then delete
   the Google data and the project, and record that you did.
8. Update the consent text and the processing records (section 9). Re-version the consent form.

## 9. Paperwork to update when you move

- Consent page, "How your data are handled": the storage location, whether Netlify is still
  in the path (if the website stays on Netlify, Netlify still sees IP addresses; hosting the
  site at LMU removes that), and any new processors. Re-check the wording of the Tremendous
  and Prolific sections.
- Record of processing activities, any data-processing agreements (Tremendous, Prolific,
  Netlify if retained), and the data-protection impact assessment if LMU requires one.
- Remove Google from the processors list once the data is deleted there. Note the deletion.
- Bump the consent version string (`CONSENT_VERSION` in `ConsentInfoPage.jsx`) so each
  participant's record shows which text they saw.

## 10. Pre-launch checks (gate before real participants)

- [ ] Storage is at LMU, or the consent text names the real location
- [ ] Temporary test settings reverted in `src/config.js`: `BLOCKS_TOTAL` 80 and
      `AUDIT_EVERY_N_BLOCKS` 10 (the `TEMP-PREVIEW` lines)
- [ ] `MAX_SESSIONS_FOR_ANALYSIS` set to 5 if five sessions is a hard limit
- [ ] Real Prolific completion codes in `PROLIFIC_COMPLETION_CODES` (currently placeholders)
- [ ] `PAYMENT_CODE_SECRET` set on the server; codes generated with that exact secret
- [ ] Password gate on the study address confirmed on (it fails open if its variables are missing)
- [ ] Each protection in section 2 tried and shown to fail correctly
- [ ] Backups restore; deletion job runs on a test copy
- [ ] Data-protection contact and ethics have seen the final consent text

## 11. Questions for LMU IT

1. Can LMU host a small web API and a database for this study, and who runs and patches them?
2. Which database and version; is disk and backup encryption provided; where are backups kept?
3. Can the study website itself be served from an LMU address (so Netlify is not needed)?
4. How are secrets stored and rotated; how do I get alerts and logs?
5. What multi-factor and network restrictions apply to admin access?
6. Is there a security review, vulnerability scan or penetration test I must pass, and how long does it take?
7. What is LMU's retention and deletion process for backups, and who signs off?
8. Can emails be sent from the server (for the payment-request alert), or must it use another route?

## 12. Known open items from the build

- Pseudonymization wording in the consent still says "participant code"; there is no code
  screen any more (the hashed participant key is the identifier). Reword.
- Quantis fallback to LFDR vs. the "hosted at LMU" claim (section 4).
- Study 1c and Prescreen rules in the same Firebase project are more open than Exp5's.
  Close them, or ensure they are removed when the Google project is retired.
- Boundary-scale (BQ-18) scoring: the notes in `questions.js` say there is no reverse scoring
  but also say "confirm". The last four items are thick-boundary items, so check before analysis.
