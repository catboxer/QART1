export const preQuestions = [
  { id: 'age', question: 'What is your age?', type: 'number' },
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
    id: 'spirituality',
    question:
      'Do you consider yourself spiritual, religious, or non-spiritual?',
    type: 'select',
    options: ['Spiritual', 'Religious', 'Non-spiritual', 'Other'],
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
    id: 'distraction',
    question:
      'Do you consider yourself easily distracted or mentally scattered?',
    type: 'select',
    options: ['Yes', 'Sometimes', 'No'],
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
    id: 'intuition',
    question:
      'Do you rely more on logic or intuition when making decisions?',
    type: 'select',
    options: ['Logic', 'Intuition', 'Both equally', 'Depends'],
  },
  {
    id: 'trust',
    question:
      'How much do you trust your intuitive or spontaneous responses?',
    type: 'slider',
    min: 0,
    max: 10,
    leftLabel: 'Not at all',
    rightLabel: 'Completely',
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
  {
    id: 'emotionNow',
    question:
      'Right now, how emotionally alive or connected do you feel?',
    type: 'slider',
    min: 0,
    max: 10,
    leftLabel: 'Numb',
    rightLabel: 'Very alive',
  },
  {
    id: 'energyNow',
    question: 'Right now, how alert or energized do you feel?',
    type: 'slider',
    min: 0,
    max: 10,
    leftLabel: 'Exhausted',
    rightLabel: 'Energized',
  },
];

export const cueBlocks = [
  {
    id: 'neutral',
    label: 'Neutral',
    instructions: 'Just choose the icon that feels right.',
    showFeedback: false,
  },
  {
    id: 'full_stack',
    label: 'Performance',
    instructions:
      'Take a breath. Feel what it is to know the answer. Stay present. Tune in. If you match the icon, you’ll receive a gold star.',
    showFeedback: true,
  },
];

export const postQuestions = [
  {
    id: 'boredomLevel',
    question:
      'How bored were you? (1 = extremely bored, 10 = not bored at all)',
    type: 'slider',
    min: 1,
    max: 10,
    leftLabel: 'Extremely bored',
    rightLabel: 'Not bored at all',
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
      'How calm did you feel? (1 = not at all, 10 = extremely calm',
    type: 'slider',
    min: 1,
    max: 10,
    leftLabel: 'Not at all',
    rightLabel: 'Extremely calm',
  },
  {
    id: 'stateEffect',
    question:
      'Describe anything you noticed about how your state affected your ability to choose.',
    type: 'textarea',
  },
  {
    id: 'finalThoughts',
    question: "Any final thoughts or feedback you'd like to share?",
    type: 'textarea',
  },
];
