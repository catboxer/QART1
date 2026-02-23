// import { config } from './config.js';
//const N_QUANTUM = config.trialsPerBlock.spoon_love;

export const preQuestions = [
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
    id: 'psiPossibility',
    question:
      'Do you think it is possible for humans to gain information or influence matter via psychic means?',
    type: 'slider',
    min: 0,
    max: 10,
    leftLabel: 'Yes, absolutely',
    rightLabel: 'No, absolutely not',
  },
];

// ——— POST ———

export const postQuestions = [
  {
    id: 'focusLevel',
    question:
      'How focused did you feel? (0 = not at all, 10 = extremely focused)',
    type: 'slider',
    min: 0,
    max: 10,
    leftLabel: 'Not at all',
    rightLabel: 'Extremely focused',
  },
  {
    id: 'calmLevel',
    question:
      'How calm did you feel? (0 = not at all, 10 = extremely calm)',
    type: 'slider',
    min: 0,
    max: 10,
    leftLabel: 'Not at all',
    rightLabel: 'Extremely calm',
  },
  {
    id: 'confidenceLevel',
    question:
      'How confident did you feel that you were nudging the results? (0 = not at all, 10 = extremely confident)',
    type: 'slider',
    min: 0,
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
