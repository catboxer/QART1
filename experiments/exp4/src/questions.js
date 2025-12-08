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

// ——— POST ———

export const postQuestions = [
  {
    id: 'binaural_beats',
    type: 'select',
    question: 'Did you listen to binaural beats during any part of this experiment?',
    options: ['No', 'Yes', 'What are binaural beats?'],
  },
  {
    id: 'binaural_level',
    question: 'What hertz did you listen to?',
    type: 'number',
    min: 1,
    max: 32,
    showIf: {
      id: 'binaural_beats',
      values: ['Yes']
    }
  },
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
