import React, { useId, useState } from 'react';

export const CONSENT_VERSION = 'EXP5_CONSENT_V1_2026-08-23';

const PI_NAME = 'Prof. Dr. Markus A. Maier';
const RESEARCHER_NAME = 'Andrea Campbell';
export const CONTACT_EMAIL = 'a.campbell@lmu.de';
const DATA_PROTECTION_CONTACT = '[DATA PROTECTION CONTACT — TO BE ADDED]';
const ETHICS_REFERENCE = 'Pending assignment';
const FIRST_SESSION_MINUTES = 25;
const LATER_SESSION_MINUTES = 5;
const RETENTION_DEADLINE = 'December 30, 2028';
export const FRIENDLY_TITLE = 'Experiment 5 – Mind & Temporal Structure';
export const FORMAL_TITLE =
  'Replication of a Paired-Delta Temporal-Structure Signature in a Quantum Random Number Generator Observer Task';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Section wrapper matching the app's existing .question-block card styling.
 */
function Section({ title, children }) {
  return (
    <section className="question-block" style={{ textAlign: 'left' }}>
      {title && (
        <h2 style={{ fontSize: '1.3rem', margin: '0 0 0.75rem' }}>{title}</h2>
      )}
      <div style={{ fontSize: 15, lineHeight: 1.65, color: 'var(--text)' }}>
        {children}
      </div>
    </section>
  );
}

function RequiredTag() {
  return (
    <span
      style={{
        color: 'var(--danger)',
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: '0.04em',
        marginLeft: 8,
        verticalAlign: 'middle',
      }}
    >
      REQUIRED
    </span>
  );
}

function OptionalTag() {
  return (
    <span
      style={{
        color: 'var(--muted)',
        fontWeight: 600,
        fontSize: 12,
        letterSpacing: '0.04em',
        marginLeft: 8,
        verticalAlign: 'middle',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '1px 6px',
      }}
    >
      OPTIONAL
    </span>
  );
}

/**
 * A single required checkbox row. Uncontrolled-looking but fully controlled;
 * never preselected by the caller (checked starts false in the parent).
 */
function RequiredCheckbox({ id, checked, onChange, children }) {
  return (
    <label
      htmlFor={id}
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        marginBottom: '0.9rem',
        cursor: 'pointer',
      }}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0 }}
        required
      />
      <span>{children}</span>
    </label>
  );
}

/**
 * Active-choice Yes/No radio group. `value` is null until the participant
 * picks one — there is no default selection.
 */
function YesNoQuestion({ legend, name, value, onChange }) {
  return (
    <fieldset
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        padding: '12px 14px',
        margin: '0 0 1rem',
      }}
    >
      <legend style={{ fontWeight: 600, padding: '0 6px', fontSize: 14.5 }}>
        {legend}
      </legend>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="radio"
            name={name}
            checked={value === true}
            onChange={() => onChange(true)}
          />
          Yes
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="radio"
            name={name}
            checked={value === false}
            onChange={() => onChange(false)}
          />
          No
        </label>
      </div>
    </fieldset>
  );
}

/**
 * ConsentInfoPage
 *
 * Participant-information and consent flow for Experiment 5. Pure UI: no
 * network or storage calls are made here. The parent is responsible for
 * persisting whatever `onAgree` receives.
 *
 * onAgree(payload) is called only once every required item is satisfied:
 *   {
 *     consentVersion: string,
 *     eligibilityConfirmed: true, // 18+ and has had a relevant experience
 *     consents: { participation, dataProcessing, withdrawalAck, anonymizedUse, emailUse, multiSession } // all true
 *     resultsContact: boolean,
 *     futureContact: boolean,
 *     email: string,           // always required, non-empty
 *   }
 *
 * onDecline() is called when the participant chooses not to participate.
 * No record of any kind should be created by the caller in that case.
 */
export default function ConsentInfoPage({ onAgree, onDecline }) {
  const idBase = useId();

  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [participationConsent, setParticipationConsent] = useState(false);
  const [dataProcessingConsent, setDataProcessingConsent] = useState(false);
  const [withdrawalAck, setWithdrawalAck] = useState(false);
  const [anonymizedUseConsent, setAnonymizedUseConsent] = useState(false);
  const [emailUseAck, setEmailUseAck] = useState(false);
  const [multiSessionAck, setMultiSessionAck] = useState(false);

  const [resultsContact, setResultsContact] = useState(null); // null | true | false
  const [futureContact, setFutureContact] = useState(null); // null | true | false
  const [email, setEmail] = useState('');
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Email is always collected -- it's used for payment and to help recover
  // a lost participant code, independent of whether the participant wants
  // to be contacted about results or future studies (those stay optional).
  const emailValid = EMAIL_RE.test(email.trim());
  const contactAnswered = resultsContact !== null && futureContact !== null;

  const ready =
    ageConfirmed &&
    participationConsent &&
    dataProcessingConsent &&
    withdrawalAck &&
    anonymizedUseConsent &&
    emailUseAck &&
    multiSessionAck &&
    contactAnswered &&
    emailValid;

  const handlePrint = () => {
    window.print();
  };

  const handleAgree = () => {
    setSubmitAttempted(true);
    if (!ready) return;
    onAgree?.({
      consentVersion: CONSENT_VERSION,
      eligibilityConfirmed: true,
      consents: {
        participation: true,
        dataProcessing: true,
        withdrawalAck: true,
        anonymizedUse: true,
        emailUse: true,
        multiSession: true,
      },
      resultsContact: !!resultsContact,
      futureContact: !!futureContact,
      email: email.trim(),
    });
  };

  return (
    <div className="App" style={{ textAlign: 'left' }}>
      <style>{`
        @media print {
          .consent-no-print { display: none !important; }
        }
      `}</style>

      {/* 1. Study identification */}
      <Section>
        <h1 style={{ marginTop: 0, marginBottom: 4 }}>{FRIENDLY_TITLE}</h1>
        <p style={{ margin: '0 0 1rem', fontSize: 14, color: 'var(--muted)' }}>
          Formal study title: {FORMAL_TITLE}
        </p>
        <p style={{ margin: '0.25rem 0' }}>
          <strong>Principal Investigator:</strong> {PI_NAME}, Ludwig-Maximilians-Universität München
        </p>
        <p style={{ margin: '0.25rem 0' }}>
          <strong>Researcher:</strong> {RESEARCHER_NAME}
        </p>
        <p style={{ margin: '0.25rem 0' }}>
          <strong>Contact:</strong>{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
        <p style={{ margin: '0.25rem 0' }}>
          <strong>Data-protection contact:</strong> {DATA_PROTECTION_CONTACT}
        </p>
        <p style={{ margin: '0.25rem 0' }}>
          <strong>Ethics committee reference:</strong> {ETHICS_REFERENCE}
        </p>
      </Section>

      {/* 2. Purpose of the study */}
      <Section title="Purpose of the study">
        <p>
          You are invited to participate in a research study examining
          whether statistical characteristics of quantum random-number-generator
          output differ under specified observer-task conditions. The study
          also examines whether individual characteristics, experiences, and
          task strategies are associated with the recorded outcomes.
        </p>
        <p>
          This is experimental research. The study is not a test of
          paranormal ability, and your individual results cannot establish
          whether you possess any particular ability.
        </p>
      </Section>

      {/* 3. What participation involves */}
      <Section title="What participation involves">
        <p>Participation consists of up to five online sessions.</p>
        <p>
          The first session includes study questionnaires followed by the
          quantum random-number-generator task. The first session is expected
          to take approximately {FIRST_SESSION_MINUTES} minutes.
        </p>
        <p>
          Sessions 2 through 5 contain a shorter set of questions and the
          quantum random-number-generator task. Each later session is
          expected to take less than {LATER_SESSION_MINUTES} minutes.
        </p>
        <p>
          During the task, you will be asked to focus on a displayed target
          and initiate a series of quantum random-number-generator calls.
          You will receive experimental feedback based on one part of the
          generated output.
        </p>
        <p>
          You may complete fewer than five sessions. Completing all five
          sessions is not required to retain payment for sessions you have
          already completed.
        </p>
      </Section>

      {/* 4. Questionnaires */}
      <Section title="Questionnaires">
        <p>
          The first session asks questions about demographic characteristics,
          meditation experience, beliefs and experiences concerning anomalous
          phenomena, self-assessed intuitive or extrasensory ability,
          awareness of bodily sensations, psychological boundaries, and
          related individual characteristics.
        </p>
        <p>
          Later sessions may ask brief questions about your focus, calmness,
          confidence, mental strategy, surroundings, and experience during
          that session.
        </p>
        <p>
          Some questions may feel personal. You may select "Prefer not to
          answer" or skip a nonessential question where that option is
          provided. Choosing not to answer an optional question will not
          affect your compensation.
        </p>
      </Section>

      {/* 5. Risks and discomforts */}
      <Section title="Risks and discomforts">
        <p>
          This study is considered low risk. Possible temporary discomforts
          include:
        </p>
        <ul>
          <li>Fatigue or loss of concentration</li>
          <li>Eyestrain or discomfort from viewing a screen</li>
          <li>
            Discomfort when answering questions about personal beliefs,
            experiences, diagnoses, or psychological characteristics
          </li>
          <li>
            The ordinary privacy risk associated with providing information
            online
          </li>
        </ul>
        <p>You may pause or stop the study at any time.</p>
        <p>
          The study is not intended to provide medical, psychological, or
          diagnostic information.
        </p>
      </Section>

      {/* 6. Voluntary participation and withdrawal */}
      <Section title="Voluntary participation and withdrawal">
        <p>
          Participation is voluntary. You may decline to participate or stop
          participating at any time without giving a reason and without
          penalty.
        </p>
        <p>
          Stopping participation will not affect the payment you have earned
          for completed sessions.
        </p>
        <p>
          While the research team can still connect your participant code to
          your contact record, you may request deletion of your identifiable
          contact information and linked research records by contacting{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
        <p>
          The participant-code linkage file will be deleted no later than{' '}
          {RETENTION_DEADLINE}. After that file is deleted, the research
          records will be anonymous. The research team will no longer be
          able to identify your individual record or delete it in response
          to an individual request.
        </p>
      </Section>

      {/* 7. Compensation */}
      <Section title="Compensation">
        <p>
          You will earn €5, or the equivalent amount offered through the
          applicable recruitment or payment service, for each completed
          session. Earnings accumulate across sessions, up to a maximum of
          €25 for all five sessions.
        </p>
        <p>
          Payment will be issued after you complete all five sessions,
          request an earlier payout, or have been inactive for 14 days. You will not lose compensation earned
          for completed sessions, even if you stop before completing all
          five. Requesting payment does not end your participation — if you
          complete additional sessions later, any additional compensation
          earned will be paid separately. Eligible payments will normally be
          processed within 7–14 days.
        </p>
        <p>
          Participants recruited through a research-participant platform may
          be paid through that platform. Participants recruited directly may
          be paid through an electronic payment service or electronic gift
          card. Payment information will be handled separately from
          questionnaire responses and experimental results.
        </p>
        <p>
          The specific payment service may vary by recruitment source. The
          payment service will receive only the information needed to issue
          payment and meet applicable financial-record requirements.
        </p>
      </Section>

      {/* 8. Data collection and pseudonymization */}
      <Section title="Data collection and pseudonymization">
        <p>The study may collect:</p>
        <ul>
          <li>A randomly generated participant code</li>
          <li>Session number, date, and time</li>
          <li>Age range, gender, and other approved demographic information</li>
          <li>Questionnaire responses</li>
          <li>
            Quantum random-number-generator output and derived task scores
          </li>
          <li>Task timing and completion information</li>
          <li>Post-session ratings and strategy responses</li>
          <li>
            Email address, required for payment administration and recovery
            of study access if you lose your private code
          </li>
          <li>
            Payment-confirmation information, stored separately from
            research responses
          </li>
        </ul>
        <p>
          Research responses will be stored under a participant code rather
          than directly under your name or email address.
        </p>
        <p>
          Your email address is connected to your participant code in a
          separate restricted linkage record. This makes the data
          pseudonymized until the linkage record is destroyed.{' '}
          {RESEARCHER_NAME} will have routine access to the linkage record.
          {PI_NAME} may access it when necessary for project oversight.
        </p>
      </Section>

      {/* 9. Data retention and sharing */}
      <Section title="Data retention and sharing">
        <p>
          Pseudonymized linkage information will be retained only as long as
          necessary for approved contact, withdrawal, payment
          administration, and data verification, and no later than{' '}
          {RETENTION_DEADLINE} unless a later date is approved and
          communicated.
        </p>
        <p>
          After removal of the linkage information, anonymized scientific
          data may be retained for at least ten years after analysis or
          publication in accordance with research-integrity requirements.
        </p>
        <p>
          Study findings may be published in scientific articles,
          presentations, grant reports, and research repositories.
          Publications will not include names, email addresses, payment
          information, participant passwords, or other information intended
          to identify individual participants.
        </p>
        <p>
          Only data reviewed for disclosure risk and determined to be
          appropriately anonymized may be placed in a public repository.
        </p>
      </Section>

      {/* 10. Email use */}
      <Section title="Email use">
        <p>
          Your email address is required for payment administration and
          recovery of your study access if you lose your private code. It
          is stored in a restricted linkage record separate from the
          primary research dataset. It will not be used for study updates
          or future-study contact unless you separately opt in below.
        </p>
        <p>
          Whether the research team may email you about study results, or
          about a future related study, is entirely your choice and answered
          separately below. Declining both will not prevent participation
          and will not affect compensation.
        </p>
        <p>
          If you opt in to results contact, the research team may email you
          a summary of the overall study findings if a participant update is
          issued. The findings may be positive, negative, mixed, or
          inconclusive.
        </p>
        <p>
          Immediate experimental feedback is part of the task but does not
          constitute an individual assessment of psychic, anomalous,
          psychological, or diagnostic ability. The study will not provide
          participants with an individualized assessment of such abilities.
        </p>
      </Section>

      {/* 11. Required eligibility and consent choices */}
      <Section title="Required eligibility and consent choices">
        <div role="group" aria-labelledby={`${idBase}-required-heading`}>
          <h3 id={`${idBase}-required-heading`} style={{ fontSize: 15, margin: '0 0 0.75rem' }}>
            Please confirm each of the following
            <RequiredTag />
          </h3>

          <RequiredCheckbox
            id={`${idBase}-age`}
            checked={ageConfirmed}
            onChange={setAgeConfirmed}
          >
            I confirm that I am at least 18 years old and have personally
            had at least one experience that I interpreted as possibly
            psi-related, anomalous, or difficult to explain through
            ordinary means.
          </RequiredCheckbox>

          <RequiredCheckbox
            id={`${idBase}-participation`}
            checked={participationConsent}
            onChange={setParticipationConsent}
          >
            I voluntarily consent to participate in this study, including
            the questionnaires and quantum random-number-generator task
            described above.
          </RequiredCheckbox>

          <RequiredCheckbox
            id={`${idBase}-data-processing`}
            checked={dataProcessingConsent}
            onChange={setDataProcessingConsent}
          >
            I consent to the collection and pseudonymized processing of my
            questionnaire responses, session information, quantum
            random-number-generator data, and task results for the research
            purposes described above.
          </RequiredCheckbox>

          <RequiredCheckbox
            id={`${idBase}-withdrawal-ack`}
            checked={withdrawalAck}
            onChange={setWithdrawalAck}
          >
            I acknowledge that I may stop participating at any time, that I
            will retain payment earned for completed sessions, and that
            individual deletion will no longer be possible after the
            participant-code linkage has been destroyed and the data have
            become anonymous.
          </RequiredCheckbox>

          <RequiredCheckbox
            id={`${idBase}-anonymized-use`}
            checked={anonymizedUseConsent}
            onChange={setAnonymizedUseConsent}
          >
            I consent to the retention, scientific analysis, publication,
            and sharing of appropriately anonymized research data as
            described above.
          </RequiredCheckbox>

          <RequiredCheckbox
            id={`${idBase}-email-use-ack`}
            checked={emailUseAck}
            onChange={setEmailUseAck}
          >
            I understand that my email address will be used for payment
            administration and recovery of my study access.
          </RequiredCheckbox>

          <RequiredCheckbox
            id={`${idBase}-multi-session-ack`}
            checked={multiSessionAck}
            onChange={setMultiSessionAck}
          >
            I understand that this consent covers up to five study
            sessions. When I return, my private participant code will be
            used to verify my existing consent and study access.
          </RequiredCheckbox>
        </div>

        <div style={{ marginTop: '1.5rem' }}>
          <label
            htmlFor={`${idBase}-email`}
            style={{ display: 'block', fontWeight: 600, marginBottom: 4, fontSize: 14.5 }}
          >
            Your email address
            <RequiredTag />
          </label>
          <input
            id={`${idBase}-email`}
            type="email"
            className="text-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-required="true"
            aria-invalid={submitAttempted && !emailValid ? 'true' : 'false'}
            aria-describedby={`${idBase}-email-explain${submitAttempted && !emailValid ? ` ${idBase}-email-error` : ''}`}
          />
          <div id={`${idBase}-email-explain`} style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>
            Used only to issue your payment and to help recover your
            participant code if you lose it. Stored in a restricted linkage
            record separate from the primary research dataset, and never
            included in published or publicly shared research data. It is
            not used to contact you about the study unless you opt in below.
          </div>
          {submitAttempted && !emailValid && (
            <div id={`${idBase}-email-error`} className="field-hint" role="alert">
              Please enter a valid email address.
            </div>
          )}
        </div>

        <div style={{ marginTop: '1.5rem' }}>
          <h3 style={{ fontSize: 15, margin: '0 0 0.75rem' }}>
            Contact preferences
            <OptionalTag />
          </h3>

          <YesNoQuestion
            legend="Would you like to receive a summary of the overall study findings if a participant update is issued?"
            name={`${idBase}-results-contact`}
            value={resultsContact}
            onChange={setResultsContact}
          />

          <YesNoQuestion
            legend={`May the research team contact you about a related follow-up or future study before ${RETENTION_DEADLINE}?`}
            name={`${idBase}-future-contact`}
            value={futureContact}
            onChange={setFutureContact}
          />
        </div>
      </Section>

      {/* 12. Save or print a copy */}
      <Section title="Save or print a copy">
        <p>
          You may save or print a copy of this study information for your
          records before deciding whether to participate.
        </p>
        <button
          type="button"
          className="secondary-btn consent-no-print"
          onClick={handlePrint}
          style={{ margin: '0.5rem 0 0' }}
        >
          Download or print study information
        </button>
      </Section>

      {submitAttempted && !ready && (
        <div
          className="field-hint consent-no-print"
          role="alert"
          aria-live="polite"
          style={{ textAlign: 'center', marginTop: '0.5rem', fontSize: 14 }}
        >
          Please confirm your age, accept all required items above, and
          answer both contact questions before continuing.
          {!emailValid && ' A valid email address is also required.'}
        </div>
      )}

      <div
        className="consent-no-print"
        style={{
          display: 'flex',
          gap: 16,
          justifyContent: 'center',
          flexWrap: 'wrap',
          marginTop: '1.5rem',
        }}
      >
        <button
          type="button"
          className="secondary-btn"
          onClick={() => onDecline?.()}
        >
          I do not wish to participate
        </button>
        <button
          type="button"
          className={`primary-btn ${ready ? '' : 'looks-disabled'}`}
          aria-disabled={ready ? 'false' : 'true'}
          onClick={handleAgree}
        >
          I consent and wish to begin
        </button>
      </div>

      <div style={{ marginTop: '1.25rem', fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
        Consent form version {CONSENT_VERSION}
      </div>
    </div>
  );
}
