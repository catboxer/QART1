import { config } from './config.js';
//const N_QUANTUM = config.trialsPerBlock.spoon_love;

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
    options: ['Female', 'Male', 'Nonbinary', 'Prefer not to say'],
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
    id: 'autism',
    question:
      'Do you have any autism spectrum diagnoses (ASD, autism, etc.)?',
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
    label: 'Physical RNG - Match One',
    preInstructions: `
   <h1>Focus & Breathe</h1>
<h3>Optional Enhancement: Binaural Beats</h3>
<ul>
  <li><strong>Try with and without.</strong> Some subjects showed a 1–3% increase in PSI ability while listening to binaural beats.Experiment by trying once with and once without them.</li>
  <li><strong>What you need:</strong> A pair of headphones.</li>
  <li><strong>How:</strong> Use <a href="https://mynoise.net/NoiseMachines/binauralBrainwaveGenerator.php" target="_blank" rel="noopener noreferrer">this binaural beat generator</a> and set the frequency between <strong>4–8&nbsp;Hz</strong>, choosing the level that feels most comfortable. If you already have a preferred app, you can use that instead—just be sure the frequency is within the <strong>4–8&nbsp;Hz</strong> range.</li>
  <li><strong>Prepare:</strong> Listen for at least 1–2 minutes before starting. Breathe deeply and try to empty your mind.</li>
</ul>

<h3>Your Task:</h3>
<ul>
  <li><strong>Draw your envelopes.</strong> Click the <em>Draw Your Sealed Envelopes</em> button. </li>
  <li><strong>Start the trials.</strong> Click the <em>Start Match One Trials</em> button when it turns green.</li>
  <li><strong>How many:</strong> ${config.trialsPerBlock.full_stack
      } trials (~${Math.ceil(
        Number(config.trialsPerBlock.full_stack) / 5
      )} rounds of 5).</li>
  <li><strong>Play in rounds.</strong> Each round has 5 trials. After each trial you will see brief feedback on whether you matched or not. After each round you’ll see your result.</li>
  <li><strong>Round win.</strong> Getting 3 or more correct out of 5 wins the round.</li>
  <li><strong>Goal.</strong> Choose the hidden symbol more often than chance (~20% per trial).</li>
  <li><strong>Need to stop early?</strong> Click <em>Exit Study</em> (bottom-right) to send your completed results.</li>
</ul>`,
    trialInstructions: `
      <h2>Physical RNG (Match One)</h2>
        <ul>
        <li>You'll see five symbols. On each trial, one is the target.</li>
        <li>Pick the one you feel is right.</li>
        <li>Encountering issues? <a href="{{ISSUE_MAILTO}}">Email us at h@whatthequark.com</a> about the problem.</li>
      </ul>`,
    showFeedback: true,
  },
  {
    id: 'spoon_love',
    label: 'Quantum RNG - Match Two',
    preInstructions: `
 <h1>Focus & Breathe</h1>
<h3>Optional Enhancement: Binaural Beats</h3>
<ul>
  <li><strong>Try with and without.</strong> Some subjects showed a 1–3% increase in PSI ability while listening to binaural beats.Experiment by trying once with and once without them.</li>
  <li><strong>What you need:</strong> A pair of headphones.</li>
  <li><strong>How:</strong> Use <a href="https://mynoise.net/NoiseMachines/binauralBrainwaveGenerator.php" target="_blank" rel="noopener noreferrer">this binaural beat generator</a> and set the frequency between <strong>4–8&nbsp;Hz</strong>, choosing the level that feels most comfortable. If you already have a preferred app, you can use that instead—just be sure the frequency is within the <strong>4–8&nbsp;Hz</strong> range.</li>

  <li><strong>Prepare:</strong> Listen for at least 1–2 minutes before starting. Breathe deeply and try to empty your mind.</li>
</ul>

<h3>Your Task:</h3>
<ul>
  <li><strong>Draw your envelopes.</strong> Click the <em>Draw Your Sealed Envelopes</em> button. </li>
  <li><strong>Start the trials.</strong> Click the <em>Start Match Two Trials</em> button when it turns green.</li>
  <li><strong>How many:</strong> ${config.trialsPerBlock.spoon_love
      } trials (~${Math.ceil(
        Number(config.trialsPerBlock.spoon_love) / 5
      )} rounds of 5).</li>
 <li><strong>Play in rounds.</strong> Each round has 5 trials. After each trial you will see brief feedback on whether you matched or not. After each round you’ll see your result.</li>
  <li><strong>Round win.</strong> Getting 3 or more correct out of 5 wins the round.</li>
  <li><strong>Goal.</strong> Choose the hidden symbol more often than chance (~20% per trial).</li>
  <li><strong>Need to stop early?</strong> Click <em>Exit Study</em> (bottom-right) to send your completed results.</li>
</ul>
`,
    trialInstructions: `
      <h2>Quantum RNG (Match Two)</h2>
        <ul>
        <li>You’ll see five symbols. On each trial, one is the target.</li>
        <li>Pick the one you feel is right.</li>
        <li>Encountering issues? <a href="{{ISSUE_MAILTO}}">Email us at h@whatthequark.com</a> about the problem.</li>
      </ul>`,
    showFeedback: false,
  },
  {
    id: 'client_local',
    label: 'Local - Match Three',
    preInstructions: `
    <h1>Focus & Breathe</h1>
<h3>Optional Enhancement: Binaural Beats</h3>
<ul>
  <li><strong>Try with and without.</strong> Some subjects showed a 1–3% increase in PSI ability while listening to binaural beats.Experiment by trying once with and once without them.</li>
  <li><strong>What you need:</strong> A pair of headphones.</li>
  <li><strong>How:</strong> Use <a href="https://mynoise.net/NoiseMachines/binauralBrainwaveGenerator.php" target="_blank" rel="noopener noreferrer">this binaural beat generator</a> and set the frequency between <strong>4–8&nbsp;Hz</strong>, choosing the level that feels most comfortable. If you already have a preferred app, you can use that instead—just be sure the frequency is within the <strong>4–8&nbsp;Hz</strong> range.</li>
  <li><strong>Prepare:</strong> Listen for at least 1–2 minutes before starting. Breathe deeply and try to empty your mind.</li>
</ul>

<h3>Your Task:</h3>
<ul>
  <li><strong>Draw your envelopes.</strong> Click the <em>Draw Your Sealed Envelopes</em> button. </li>
  <li><strong>Start the trials.</strong> Click the <em>Start Match Three Trials</em> button when it turns green.</li>
  <li><strong>How many:</strong> ${config.trialsPerBlock.client_local
      } trials (~${Math.ceil(
        Number(config.trialsPerBlock.client_local) / 5
      )} rounds of 5).</li>
<li><strong>Play in rounds.</strong> Each round has 5 trials. After each trial you will see brief feedback on whether you matched or not. After each round you’ll see your result.</li>
  <li><strong>Round win.</strong> Getting 3 or more correct out of 5 wins the round.</li>
  <li><strong>Goal.</strong> Choose the hidden symbol more often than chance (~20% per trial).</li>
  <li><strong>Need to stop early?</strong> Click <em>Exit Study</em> (bottom-right) to send your completed results.</li>
</ul>
`,
    trialInstructions: `
      <h2>Local (Match Three)</h2>
        <ul>
        <li>You’ll see five symbols. On each trial, one is the target.</li>
        <li>Pick the one you feel is right.</li>
        <li>Encountering issues? <a href="{{ISSUE_MAILTO}}">Email us at h@whatthequark.com</a> about the problem.</li>
      </ul>`,
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
    id: 'binaural_beats',
    type: 'select',
    question: 'Did you listen to binaural beats during any part of this experiment?',
    options: ['No', 'Yes - during all blocks', 'Yes - during Block 1 (Physical)', 'Yes - during Block 2 (Quantum)', 'Yes - during Block 3 (Local)', 'What are binaural beats?'],
  },
  {
    id: 'binaural_level',
    question: 'What hertz did you listen to?',
    type: 'number',
    min: 1,
    max: 32,
    showIf: {
      id: 'binaural_beats',
      values: [
        'Yes - during all blocks',
        'Yes - during Block 1 (Physical)',
        'Yes - during Block 2 (Quantum)',
        'Yes - during Block 3 (Local)'
      ]
    }
  },
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
