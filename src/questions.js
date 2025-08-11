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
    instructions:
      'Press RIGHT once per trial. Outcome comes from a physical RNG. No per-trial feedback.',
    showFeedback: false,
  },
  {
    id: 'spoon_love',
    label: 'Quantum',
    instructions:
      'Focus on RIGHT, press RIGHT once. Outcome comes from a quantum RNG. Star shows when aligned.',
    showFeedback: true,
  },
];

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
