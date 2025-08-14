// ——— PRE ———
export const preQuestions = [
  //   { id: 'name', question: 'What is your name?', type: 'text' },
  // {
  //   id: 'email',
  //   question:
  //     'What is your email? *(optional—only used by research team if your results are unusually high)',
  //   type: 'email',
  // },
  {
    id: 'age',
    question: 'What is your age?',
    type: 'number',
    min: 18,
  },
  {
    id: 'gender',
    question: 'Gender (optional):',
    type: 'select',
    options: ['Male', 'Female', 'Nonbinary', 'Prefer not to say'],
  },
  {
    id: 'meditation',
    question: 'Do you meditate or have a regular awareness practice?',
    type: 'select',
    options: [
      'Yes, daily',
      'Yes, a few times per week',
      'Occasionally',
      'Rarely or never',
    ],
  },
  {
    id: 'diagnosis',
    question:
      'Do you have any attention-related diagnoses (ADHD, ADD, etc.)?',
    type: 'select',
    options: ['Yes', 'No', 'Not sure / Self-diagnosed'],
  },
  {
    id: 'screenTime',
    question:
      'How many hours per day do you spend on a screen (not counting work)?',
    type: 'slider',
    min: 0,
    max: 12,
    leftLabel: 'None',
    rightLabel: '12+ hours',
  },
  {
    id: 'scrolling',
    question:
      'How often do you lose track of time while scrolling or multitasking?',
    type: 'select',
    options: ['Frequently', 'Sometimes', 'Rarely', 'Never'],
  },
  {
    id: 'deepWork',
    question:
      'How much time per day do you spend in deep focus activities (reading, coding, etc.)?',
    type: 'select',
    options: [
      'More than 2 hours',
      '1–2 hours',
      'Less than 1 hour',
      'Rarely or never',
    ],
  },
  {
    id: 'flow',
    question:
      'Do you experience flow (being fully absorbed) regularly?',
    type: 'select',
    options: ['Often', 'Occasionally', 'Rarely', 'Never'],
  },
  {
    id: 'clarityNow',
    question: 'Right now, how mentally clear do you feel?',
    type: 'slider',
    min: 0,
    max: 10,
    leftLabel: 'Foggy',
    rightLabel: 'Crystal clear',
  },
];

// ——— BLOCK METADATA ———
export const cueBlocks = [
  {
    id: 'full_stack',
    label: 'Practice Baseline',
    buttonLabel: 'LOVE',
    preInstructions: `
      <h1>Focus & Breathing – Baseline Block</h1>
      <h2><strong>Your Task:</strong> </h2>
<ul>
  <li>You will see a green button labeled <strong>{{WORD}}</strong>.</li>
  <li>Your challenge is to keep your attention on this word and see if you can nudge the Random Number Generator ever so slightly—beyond pure chance.</li>
  <li><strong>PRESS</strong> and <strong>HOLD</strong> the {{WORD}} button as you bring your focus fully onto the concept it represents to you.</li>
  <li>Do not release until you feel truly refocused and sense the right moment to act.</li>
  <li>If your mind drifts (and it probably will), simply notice the distraction and gently return your focus to {{WORD}}.</li>
  <li><strong>RELEASE</strong> the button only when you feel calm, steady, and ready.</li>
</ul>
 `,
    trialInstructions: `
      <h2>Baseline</h2>
        <ul>
        <li><strong>PRESS </strong> the {{WORD}} button.</li>
        <li><strong>HOLD</strong> the button down.</li>
        <li><strong>REFOCUS</strong> when distracted.</li>
        <li><strong>RELEASE </strong>when it feels right.</li>
      </ul>
        <p style="margin:0">Wait until the button text {{WORD}} turns black before pressing again.</p>
      <p style="margin:0">If the network hiccups you will receive an alert. Press again.</p>
    <p style="margin:0">Encountering issues? <a href="{{ISSUE_MAILTO}}">Email us at h@whatthequark.com</a> about the problem.</p>
      `,
    showFeedback: false,
  },
  {
    id: 'spoon_love',
    label: 'Quantum',
    buttonLabel: 'LOVE',
    preInstructions: `
      <h2>Focus & Breathing – Quantum Block</h2>
      <h2><strong>Your Task:</strong> </h2>
<ul>
  <li>You will see a green button labeled <strong>{{WORD}}</strong>.</li>
  <li>Your challenge is to keep your attention on this word and see if you can nudge the RNG ever so slightly—beyond pure chance.</li>
  <li><strong>PRESS</strong> and <strong>HOLD</strong> the {{WORD}} button as you bring your focus fully onto the concept it represents for you.</li>
  <li>Do not release until you feel truly refocused and sense the right moment to act.</li>
  <li>If your mind drifts (and it probably will), simply notice the distraction and gently return your focus to {{WORD}}.</li>
  <li><strong>RELEASE</strong> the button only when you feel calm, steady, and ready.</li>
</ul>
      <div class="why-this-matters">
  <p><strong>Why this matters</strong></p>
  <p>
    This block is very boring and that’s intentional. The challenge is staying focused despite wandering thoughts. That skill tends to improve with practice. We’re exploring whether better focus correlates with better-than-chance scores.
  </p>
  <p>
    <em>Goal:</em> Work toward completing all 100 trials with minimal lapses. Treat it like a growth exercise and notice how your focus (and score) change over time. 
    <p>Please use the Exit Study button at the bottom right of the screen to record your results if you cannot finish the trial. </p>
  </p>
</div> `,
    trialInstructions: `
      <h2>Main Experiment</h2>
      <ul>
        <li><strong>PRESS </strong> the {{WORD}} button.</li>
        <li><strong>HOLD</strong></li>
        <li><strong>REFOCUS</strong> when distracted.</li>
        <li><strong>RELEASE </strong>when it feels right.</li>
      </ul>
      <p style="margin:0">Wait until the button text {{WORD}} turns black before pressing again.</p>
      <p style="margin:0">If the network hiccups you will receive an alert. Press again.</p>
    <p style="margin:0">Encountering issues? <a href="{{ISSUE_MAILTO}}">Email us about the problem</a>.</p>
      `,
    showFeedback: false,
  },
];
export function buildIssueMailto(sessionId) {
  const subject = 'Experiment issue report';
  const body = `Hi team,

I hit a problem during the experiment.

- What I was doing: [brief steps]
- What happened: [error message or behavior]
- When: [date/time and timezone]
- Device / browser: [e.g., iPhone 14, Safari]
- Session ID: ${sessionId}

Thanks!`;
  return (
    'mailto:h@whatthequark.com' +
    '?subject=' +
    encodeURIComponent(subject) +
    '&body=' +
    encodeURIComponent(body)
  );
}
export function buildIssueEmailBody(sessionId) {
  return `Hi team,

I hit a problem during the experiment.

- What I was doing: [brief steps]
- What happened: [error message or behavior]
- When: [date/time and timezone]
- Device / browser: [e.g., iPhone 14, Safari]
- Session ID: ${sessionId}

Thanks!`;
}

// ——— MID (between blocks) ———
export const midQuestions = [
  {
    id: 'confidence',
    type: 'slider',
    min: 0,
    max: 100,
    leftLabel: 'Not at all',
    rightLabel: 'Extremely',
    question:
      'How confident are you that you can nudge above 50% (chance) the quantum outcome toward RIGHT in the next block?',
  },
  {
    id: 'knowledge',
    type: 'slider',
    min: 0,
    max: 100,
    leftLabel: 'Not at all',
    rightLabel: 'Extremely',
    question: 'How confident are you that you know what to do?',
  },
  {
    id: 'focus',
    type: 'slider',
    min: 0,
    max: 100,
    leftLabel: 'Not at all',
    rightLabel: 'Extremely',
    question: 'How focused did you feel during this block?',
  },
  {
    id: 'expectation_pct',
    type: 'slider',
    min: 0,
    max: 100,
    leftLabel: '0%',
    rightLabel: '100%',
    question:
      'What percentage do you expect to achieve in the quantum block?',
  },
];

// ——— POST ———

export const postQuestions = [
  {
    id: 'focusLevel',
    question:
      'How focused did you feel? (1 = not at all, 10 = extremely focused)',
    type: 'slider',
    min: 1,
    max: 10,
    leftLabel: 'Not at all',
    rightLabel: 'Extremely focused',
  },
  {
    id: 'calmLevel',
    question:
      'How calm did you feel? (1 = not at all, 10 = extremely calm)',
    type: 'slider',
    min: 1,
    max: 10,
    leftLabel: 'Not at all',
    rightLabel: 'Extremely calm',
  },
  {
    id: 'confidenceLevel',
    question:
      'How confident did you feel that you were nudging the results? (1 = not at all, 10 = extremely confident)',
    type: 'slider',
    min: 1,
    max: 10,
    leftLabel: 'Not at all',
    rightLabel: 'Extremely confident',
  },
  {
    id: 'finalThoughts',
    question:
      "Any final thoughts or feedback you'd like to share? (optional)",
    type: 'textarea',
  },
];
