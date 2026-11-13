import React, { useId, useState } from 'react';
import { pkConfig as C } from '../config.js';

// Base version; the displayed/stored version carries a suffix for the form
// variant shown (Prolific-recruited vs. directly recruited participants).
export const CONSENT_VERSION = 'STUDY_2_CONSENT_V1_2026-11-11';

const PI_NAME = 'Prof. Dr. Markus A. Maier';
const PI_EMAIL = 'markus.maier@psy.lmu.de';
const RESEARCHER_NAME = 'Andrea Campbell';
export const CONTACT_EMAIL = 'a.campbell@lmu.de';
const DATA_PROTECTION_NAME = 'Prof. Dr. Nicolae Nistor';
const DATA_PROTECTION_EMAIL = 'datenschutz.psychologie@psy.lmu.de';
const ETHICS_REFERENCE = 'Pending assignment';
const FIRST_SESSION_MINUTES = 25;
const LATER_SESSION_MINUTES = 5;
const RETENTION_DEADLINE = 'December 30, 2028';
export const FRIENDLY_TITLE = 'Study 2 – Mind & Temporal Structure';
export const FORMAL_TITLE =
  'Paired-Delta Protocol: Study 2 - A Preregistered Replication and Extension of the Pilot Study';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Section wrapper matching the app's existing .question-block card styling.
 */
function Section({ title, children }) {
  return (
    <section className="question-block" style={{ textAlign: 'left' }}>
      {title && (
        <h2 style={{ fontSize: '1.3rem', margin: '0 0 0.75rem' }}>
          {title}
        </h2>
      )}
      <div
        style={{
          fontSize: 15,
          lineHeight: 1.65,
          color: 'var(--text)',
        }}
      >
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
      <legend
        style={{ fontWeight: 600, padding: '0 6px', fontSize: 14.5 }}
      >
        {legend}
      </legend>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <label
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            cursor: 'pointer',
          }}
        >
          <input
            type="radio"
            name={name}
            checked={value === true}
            onChange={() => onChange(true)}
          />
          Yes
        </label>
        <label
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            cursor: 'pointer',
          }}
        >
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
 *     eligibilityConfirmed: true, // 18+ and understands the English-language study information (separate voluntary-consent checkbox -> consents.participation)
 *     consents: { participation, dataProcessing, withdrawalAck, anonymizedUse, emailUse, multiSession, dataHandling } // all true
 *     resultsContact: boolean,
 *     futureContact: boolean,
 *     recruitmentSource: 'prolific'|'direct',
 *     email: string|null,      // direct: required; prolific: null
 *     prolificId: string|null, // prolific: from URL; direct: null
 *   }
 *
 * onDecline() is called when the participant chooses not to participate.
 * No record of any kind should be created by the caller in that case.
 */
export default function ConsentInfoPage({
  onAgree,
  onDecline,
  recruitment,
}) {
  const idBase = useId();
  // Prolific-recruited participants arrive with ?PROLIFIC_PID=... in the URL
  // (see lib/recruitment.js); everyone else sees the direct-recruitment form
  // (email required, paid via Tremendous). Only the consent page differs.
  const isProlific =
    recruitment?.source === 'prolific' && !!recruitment?.prolificId;
  // Volunteers (no Prolific ID, no personal payment code in the link) are not paid:
  // all payment wording is removed for them. They still give an email to link sessions.
  const isVolunteer = !isProlific && recruitment?.source === 'volunteer';
  const prolificId = isProlific ? recruitment.prolificId : '';
  const consentVersion = `${CONSENT_VERSION}_${isProlific ? 'PROLIFIC' : isVolunteer ? 'VOLUNTEER' : 'DIRECT'}`;

  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [participationConsent, setParticipationConsent] =
    useState(false);
  const [dataProcessingConsent, setDataProcessingConsent] =
    useState(false);
  const [withdrawalAck, setWithdrawalAck] = useState(false);
  const [anonymizedUseConsent, setAnonymizedUseConsent] =
    useState(false);
  const [emailUseAck, setEmailUseAck] = useState(false);
  const [multiSessionAck, setMultiSessionAck] = useState(false);
  const [dataHandlingAck, setDataHandlingAck] = useState(false);

  const [resultsContact, setResultsContact] = useState(null); // null | true | false
  const [futureContact, setFutureContact] = useState(null); // null | true | false
  const [email, setEmail] = useState('');
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Direct participants must give a valid email (used for payment).
  // Prolific participants are identified by the Prolific ID from the URL and
  // are not asked for an email, so the two email-contact questions apply
  // (and are required) only to direct participants.
  const hasEmail = !isProlific && email.trim() !== '';
  const emailValid = isProlific || EMAIL_RE.test(email.trim());
  const contactAnswered =
    isProlific || (resultsContact !== null && futureContact !== null);

  const ready =
    ageConfirmed &&
    participationConsent &&
    dataProcessingConsent &&
    withdrawalAck &&
    anonymizedUseConsent &&
    emailUseAck &&
    multiSessionAck &&
    dataHandlingAck &&
    contactAnswered &&
    emailValid;

  const handlePrint = () => {
    window.print();
  };

  const handleAgree = () => {
    setSubmitAttempted(true);
    if (!ready) return;
    onAgree?.({
      consentVersion,
      recruitmentSource: isProlific ? 'prolific' : isVolunteer ? 'volunteer' : 'direct',
      eligibilityConfirmed: true,
      consents: {
        participation: true,
        dataProcessing: true,
        withdrawalAck: true,
        anonymizedUse: true,
        emailUse: true,
        multiSession: true,
        dataHandling: true,
      },
      resultsContact: hasEmail && !!resultsContact,
      futureContact: hasEmail && !!futureContact,
      email: hasEmail ? email.trim() : null,
      prolificId: isProlific ? prolificId : null,
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
        <h1 style={{ marginTop: 0, marginBottom: 4 }}>
          {FRIENDLY_TITLE}
        </h1>
        <p
          style={{
            margin: '0 0 1rem',
            fontSize: 14,
            color: 'var(--muted)',
          }}
        >
          Formal study title: {FORMAL_TITLE}
        </p>
        <p style={{ margin: '0.25rem 0' }}>
          <strong>Principal Investigator:</strong> {PI_NAME},
          Ludwig-Maximilians-Universität München
          <br />
          <strong>Contact:</strong>{' '}
          <a href={`mailto:${PI_EMAIL}`}>{PI_EMAIL}</a>
        </p>
        <p style={{ margin: '0.25rem 0' }}>
          <strong>Researcher:</strong> {RESEARCHER_NAME}
          <br />
          <strong>Contact:</strong>{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
        <p style={{ margin: '0.25rem 0' }}>
          <strong>Data-protection contact:</strong>{' '}
          {DATA_PROTECTION_NAME}, Ludwig-Maximilians-Universität
          München
          <br />
          <strong>Contact:</strong>{' '}
          <a href={`mailto:${DATA_PROTECTION_EMAIL}`}>
            {DATA_PROTECTION_EMAIL}
          </a>
        </p>
        <p style={{ margin: '0.25rem 0' }}>
          <strong>Ethics committee reference:</strong>{' '}
          {ETHICS_REFERENCE}
        </p>
      </Section>

      {/* 2. Purpose of the study */}
      <Section title="Purpose of the study">
        <p>
          This study asks whether the pattern of random numbers
          differs when a person focuses their intention on a target,
          compared with when no person is involved. We also ask
          whether people's experiences, personal traits and task
          strategies, measured by the questionnaires, are related to
          the results.
        </p>
        <p>
          The random numbers come from a quantum random number
          generator. This device produces numbers from the random
          behaviour of particles of light (photons). Nobody, including
          the researchers, can predict this behaviour in advance, so
          the numbers work like a perfectly fair coin flip.
        </p>
        <p>
          This is experimental research. The study is not a test of
          paranormal ability, and your individual results cannot
          establish whether you possess any particular ability.
        </p>
      </Section>

      {/* 3. What participation involves */}
      <Section title="What participation involves">
        <p>Participation consists of up to five online sessions.</p>
        <p>
          The first session includes study questionnaires followed by
          the color intent task. The first session
          is expected to take approximately {FIRST_SESSION_MINUTES}{' '}
          minutes.
        </p>
        <p>
          Sessions 2 through 5 contain a shorter set of questions and
          the color intent task. Each later session
          is expected to take less than {LATER_SESSION_MINUTES}{' '}
          minutes.
        </p>
        <p>
          During the task, you will focus on an assigned target color
          and mentally intend for the target color result to exceed
          50%. There is no required mental strategy. Each session
          consists of {C.BLOCKS_TOTAL} blocks, and you will receive
          experimental feedback after each block.
        </p>
        <p>
          We ask you to complete all five sessions, as the study
          depends on it. Taking part is still voluntary: you may stop
          at any time
          {!isVolunteer &&
            ', and completing all five sessions is not required to retain payment for sessions you have already completed'}
          .
        </p>
      </Section>

      {/* 4. Questionnaires */}
      <Section title="Questionnaires">
        <p>
          The first session includes 77 questionnaire items covering
          demographic characteristics, meditation experience, beliefs
          and experiences concerning anomalous phenomena,
          self-assessed intuitive or extrasensory ability,
          psychological boundaries, sensory sensitivity,
          transliminality, and related individual characteristics.
        </p>
        <p>
          Later sessions may ask brief questions about your focus,
          calmness, confidence, self-selected mental approach, surroundings, and
          experience during that session.
        </p>
      </Section>

      {/* 5. Risks and discomforts */}
      <Section title="Risks and discomforts">
        <p>
          This study is considered low risk. Possible temporary
          discomforts include:
        </p>
        <ul>
          <li>Fatigue or loss of concentration</li>
          <li>Eyestrain or discomfort from viewing a screen</li>
          <li>
            Discomfort when answering questions about personal
            beliefs, experiences, diagnoses, or psychological
            characteristics
          </li>
          <li>
            The ordinary privacy risk associated with providing
            information online
          </li>
        </ul>
        <p>You may pause or stop the study at any time.</p>
        <p>
          The study is not intended to provide medical, psychological,
          or diagnostic information.
        </p>
      </Section>

      {/* 6. Voluntary participation and withdrawal */}
      <Section title="Voluntary participation and withdrawal">
        <p>
          Participation is voluntary. You may decline to participate
          or stop participating at any time without giving a reason
          and without penalty.
        </p>
        {!isVolunteer && (
          <p>
            Stopping participation will not affect the payment you have
            earned for completed sessions.
          </p>
        )}
        <p>
          While the research team can still connect your participant
          code to your contact record, you may request deletion of
          your identifiable contact information and linked research
          records by contacting{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
        <p>
          The participant-code linkage file will be deleted no later
          than {RETENTION_DEADLINE}. After that file is deleted and the
          remaining research records have been anonymized, the
          research team will
          no longer be able to identify your individual record or
          delete it in response to an individual request.
        </p>
      </Section>

      {/* 7. Compensation (not shown to volunteers) */}
      {!isVolunteer && (
      <Section title="Compensation">
        {isProlific ? (
          <>
            <p>
              You will earn €5 for each completed session, up to a
              maximum of €25 for all five sessions. Prolific pays you
              after each completed session, in US dollars, in an
              amount equal to €5 at the current exchange rate.
            </p>
            <p>
              Payment information will be handled separately from
              questionnaire responses and experimental results.
            </p>
          </>
        ) : (
          <>
            <p>
              You will earn €5, or the equivalent amount offered
              through the applicable recruitment or payment service,
              for each completed session. Earnings accumulate across
              sessions, up to a maximum of €25 for all five sessions.
            </p>
            <p>
              Payment will be issued after you complete all five
              sessions, request an earlier payout, or two weeks after
              the study has closed. If you request payment before
              completing all five sessions, your participation will
              end and you will not be able to complete additional
              sessions. You will receive €5 for each session you have
              already completed. If you decide not to complete all
              five sessions, you must use the "Request payment now"
              option or contact the research team to request payment
              for your completed sessions. Eligible payments will
              normally be processed within 7–14 days.
            </p>
            <p>
              You will be paid through Tremendous (USA) in the form of
              an electronic gift card you choose from those available
              in your country, for example an Amazon gift card. The
              amount is €5 per session, or the equivalent in the
              currency of the option you choose. Payment information
              will be handled separately from questionnaire responses
              and experimental results. Tremendous will receive only
              your email address and the amount to be paid.
            </p>
          </>
        )}
      </Section>
      )}

      {/* 8. Data collection and pseudonymization */}
      <Section title="Data collection and pseudonymization">
        <p>The study may collect:</p>
        <ul>
          <li>A randomly generated participant code</li>
          <li>Session number, date, and time</li>
          <li>
            Age, gender, and other approved demographic information
          </li>
          <li>Questionnaire responses</li>
          <li>
            Quantum random number generator output and derived task
            scores
          </li>
          <li>Task timing and completion information</li>
          <li>Post-session ratings and strategy responses</li>
          <li>
            {isProlific
              ? 'Your Prolific participant ID, used for payment through Prolific'
              : isVolunteer
                ? 'Your email address, used to link your study sessions together'
                : 'Your email address, required for payment administration, and the payment code contained in your personal study link'}
          </li>
          {!isVolunteer && (
            <li>
              Payment-confirmation information, stored separately from
              research responses
            </li>
          )}
        </ul>
        <p>
          Research responses are stored on a server at
          Ludwig-Maximilians-Universität München (LMU), under a
          participant code rather than directly under your name or
          email address.
        </p>
        <p>
          Your {isProlific ? 'Prolific ID' : 'email address'} is
          connected to your participant code in a separate restricted
          linkage record. This makes the data pseudonymized until the
          linkage record is destroyed. {RESEARCHER_NAME} will have routine
          access to the linkage record. {PI_NAME} may access it when
          necessary for project oversight.
        </p>
        {!isVolunteer && (
          <p>
            {isProlific
              ? 'You are paid through Prolific, which receives none of your answers.'
              : 'You are paid by gift card through Tremendous (USA), which receives your email address and the amount to be paid, but none of your answers.'}
          </p>
        )}
      </Section>

      {/* 9. Data retention and sharing */}
      <Section title="Data retention and sharing">
        <p>
          Pseudonymized linkage information will be retained only as
          long as necessary for approved contact, withdrawal,{' '}
          {isVolunteer ? '' : 'payment administration, '}and data
          verification, and no later than{' '}
          {RETENTION_DEADLINE}. A future extension would require
          appropriate approval and possibly revised participant
          information; this consent does not give advance permission
          for an unspecified extension.
        </p>
        <p>
          After removal of the linkage information and review of
          disclosure risk, anonymized scientific data may be retained for at least ten years after
          analysis or publication in accordance with
          research-integrity requirements.
        </p>
        <p>
          Study findings may be published in scientific articles,
          presentations, grant reports, and research repositories.
          Publications will not include names, email addresses,
          {isVolunteer ? '' : ' payment information,'} private participant codes, or other
          information intended to identify individual participants.
        </p>
        <p>
          Only data reviewed for disclosure risk and determined to be
          appropriately anonymized may be placed in a public
          repository.
        </p>
      </Section>

      {/* 10. Email use */}
      <Section title={isProlific ? 'Contact and study updates' : 'Email use'}>
        {isProlific ? (
          <p>
            Your Prolific ID is used for payment administration. It is
            stored in a restricted linkage record separate
            from the primary research dataset. The research team can
            only contact you through Prolific.
          </p>
        ) : (
          <>
            <p>
              Your email address is required for{' '}
              {isVolunteer
                ? 'linking your study sessions together'
                : 'payment administration'}
              . It is stored in a restricted
              linkage record separate from the primary research
              dataset. It will not be used for study updates or
              future-study contact unless you separately opt in
              below.
            </p>
            <p>
              If you choose to receive the study results, we will
              email you a copy of the results when they are available.
              If you are open to taking part in future studies,
              answer Yes to the second question below. Neither choice
              affects your participation{isVolunteer ? '' : ' or compensation'}.
              If you answer these questions again in a later session,
              your most recent answers are the ones we use.
            </p>
          </>
        )}
        <p>
          Immediate experimental feedback is part of the task but does
          not constitute an individual assessment of psychic,
          anomalous, psychological, or diagnostic ability. The study
          will not provide participants with an individualized
          assessment of such abilities.
        </p>
      </Section>

      {/* 10b. How your data are handled */}
      {/* TODO(DPO): confirm wording and add legal basis / transfer
          safeguards for the US-based processors (Netlify, Tremendous)
          before launch. */}
      <Section title="How your data are handled">
        <p>
          <strong>Research responses</strong> (questionnaires, task
          results, and quantum random number generated data) are
          stored on a server at Ludwig-Maximilians-Universität München
          (LMU) under your participant code.
        </p>
        <p>
          <strong>Linkage record.</strong> Your{' '}
          {isProlific ? 'Prolific ID' : 'email address'} is kept in a
          separate restricted record that connects it to your
          participant code. It is not part of
          the research dataset.
        </p>
        <p>
          <strong>Website hosting (Netlify, USA).</strong> The study
          website is delivered by Netlify. As with any website, Netlify
          receives your IP address when your browser connects. The
          study also uses a Netlify function to request random numbers
          from the quantum random number generator hosted on LMU
          servers and pass them on to your browser. The random numbers
          therefore pass through Netlify in transit; the study does
          not store them there. Netlify does not receive your
          questionnaire answers, your{' '}
          {isProlific ? 'Prolific ID' : 'email address'}, or your
          participant code.
        </p>
        {!isVolunteer && (
        <p>
          <strong>Payment.</strong>{' '}
          {isProlific
            ? 'Prolific pays you after each session. The study never sees your identity, only your Prolific ID, and Prolific never sees your answers.'
            : 'You are paid by the research team through Tremendous (USA), which receives your email address and the amount to be paid, but none of your answers.'}
        </p>
        )}
      </Section>

      {/* 11. Required eligibility and consent choices */}
      <Section title="Required eligibility and consent choices">
        <div
          role="group"
          aria-labelledby={`${idBase}-required-heading`}
        >
          <h3
            id={`${idBase}-required-heading`}
            style={{ fontSize: 15, margin: '0 0 0.75rem' }}
          >
            Please confirm each of the following
            <RequiredTag />
          </h3>

          <RequiredCheckbox
            id={`${idBase}-age`}
            checked={ageConfirmed}
            onChange={setAgeConfirmed}
          >
            I confirm that I am at least 18 years old and can
            understand the English-language study information and
            instructions.
          </RequiredCheckbox>

          <RequiredCheckbox
            id={`${idBase}-participation`}
            checked={participationConsent}
            onChange={setParticipationConsent}
          >
            I voluntarily consent to participate in this study,
            including the questionnaires and color intent task
            described above.
          </RequiredCheckbox>

          <RequiredCheckbox
            id={`${idBase}-data-processing`}
            checked={dataProcessingConsent}
            onChange={setDataProcessingConsent}
          >
            I consent to the collection and pseudonymized processing
            of my questionnaire responses, session information,
            quantum random number generator data, and task results for
            the research purposes described above.
          </RequiredCheckbox>

          <RequiredCheckbox
            id={`${idBase}-withdrawal-ack`}
            checked={withdrawalAck}
            onChange={setWithdrawalAck}
          >
            I acknowledge that I may stop participating at any time,
            {isVolunteer ? ' ' : ' that I will retain payment earned for completed sessions, '}
            and that individual deletion will no longer be possible
            after the participant-code linkage has been destroyed and
            the data have become anonymous.
          </RequiredCheckbox>

          <RequiredCheckbox
            id={`${idBase}-anonymized-use`}
            checked={anonymizedUseConsent}
            onChange={setAnonymizedUseConsent}
          >
            I understand that appropriately anonymized research data
            may be retained, scientifically analyzed, published, and
            shared as described above.
          </RequiredCheckbox>

          <RequiredCheckbox
            id={`${idBase}-email-use-ack`}
            checked={emailUseAck}
            onChange={setEmailUseAck}
          >
            {isProlific
              ? 'I understand that my Prolific ID will be used for payment administration.'
              : isVolunteer
                ? 'I understand that my email address will be used to link my study sessions together.'
                : 'I understand that my email address will be used for payment administration.'}
          </RequiredCheckbox>

          <RequiredCheckbox
            id={`${idBase}-multi-session-ack`}
            checked={multiSessionAck}
            onChange={setMultiSessionAck}
          >
            I understand that this consent covers up to five study
            sessions, and that I need to use the same personal link
            each time I return.
          </RequiredCheckbox>

          <RequiredCheckbox
            id={`${idBase}-data-handling-ack`}
            checked={dataHandlingAck}
            onChange={setDataHandlingAck}
          >
            I understand how my data are collected, stored and used,
            as described in "How your data are handled", including
            that my IP address goes to Netlify (USA)
            {isProlific
              ? ' and that Prolific handles my payment and identity verification.'
              : isVolunteer
                ? '.'
                : ' and that my email address and the amount to be paid go to Tremendous (USA).'}
          </RequiredCheckbox>
        </div>

        {!isProlific && (
        <div style={{ marginTop: '1.5rem' }}>
          <label
            htmlFor={`${idBase}-email`}
            style={{
              display: 'block',
              fontWeight: 600,
              marginBottom: 4,
              fontSize: 14.5,
            }}
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
            aria-invalid={
              submitAttempted && !emailValid ? 'true' : 'false'
            }
            aria-describedby={`${idBase}-email-explain${submitAttempted && !emailValid ? ` ${idBase}-email-error` : ''}`}
          />
          <div
            id={`${idBase}-email-explain`}
            style={{
              fontSize: 12.5,
              color: 'var(--muted)',
              marginTop: 4,
            }}
          >
            {isVolunteer
              ? 'Used only to link your study sessions together.'
              : 'Used only to issue your payment.'}{' '}
            Stored in a restricted
            linkage record separate from the primary research dataset,
            and never included in published or publicly shared
            research data. It is not used to contact you about the
            study unless you opt in below.
          </div>
          {submitAttempted && !emailValid && (
            <div
              id={`${idBase}-email-error`}
              className="field-hint"
              role="alert"
            >
              Please enter a valid email address.
            </div>
          )}
        </div>
        )}

        {isProlific && (
          <div style={{ marginTop: '1.5rem' }}>
            <div style={{ fontWeight: 600, fontSize: 14.5 }}>
              Your Prolific ID: <code>{prolificId}</code>
            </div>
            <div
              style={{
                fontSize: 12.5,
                color: 'var(--muted)',
                marginTop: 4,
              }}
            >
              Taken automatically from your Prolific link. Used to pay
              you through Prolific and stored in a restricted linkage
              record separate from the primary research dataset.
            </div>
          </div>
        )}

        {!isProlific && (
        <div style={{ marginTop: '1.5rem' }}>
          <h3 style={{ fontSize: 15, margin: '0 0 0.75rem' }}>
            Contact preferences
            <RequiredTag />
          </h3>
          <p
            style={{
              fontSize: 13.5,
              color: 'var(--muted)',
              margin: '0 0 0.75rem',
            }}
          >
            You must answer Yes or No to both questions, but either
            answer is acceptable and will not affect your
            participation{isVolunteer ? '' : ' or compensation'}.
          </p>

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
        )}
      </Section>

      {/* 12. Save or print a copy */}
      <Section title="Save or print a copy">
        <p>
          You may save or print a copy of this study information for
          your records before deciding whether to participate.
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
          style={{
            textAlign: 'center',
            marginTop: '0.5rem',
            fontSize: 14,
          }}
        >
          Please accept all required items above
          {!isProlific && ' and answer both contact questions'} before
          continuing.
          {!isProlific &&
            !emailValid &&
            ' A valid email address is also required.'}
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

      <div
        style={{
          marginTop: '1.25rem',
          fontSize: 12,
          color: 'var(--muted)',
          textAlign: 'center',
        }}
      >
        Consent form version {consentVersion}
      </div>
    </div>
  );
}
