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
    question: 'Gender:',
    type: 'select',
    options: ['Female', 'Male', 'Nonbinary', 'Prefer not to say'],
  },
  {
    id: 'meditationLevel',
    question: 'What is your level of experience with meditation or deep-focus practice?',
    type: 'select',
    options: [
      'Daily practice (Long-term / 1+ years)',
      'Regular practice (Daily or weekly / Recent)',
      'Occasional / Beginner',
      'None / Rarely',
    ],
  },
  {
    id: 'experienceTypes',
    question: 'Which of the following have you experienced? Select all that apply.',
    type: 'checkbox',
    options: [
      { label: 'Precognition — knowing something before you could have known it', value: 'precognition' },
      { label: 'Remote viewing — perceiving a distant location or object', value: 'remote_viewing' },
      { label: 'Telepathy — direct mind-to-mind communication', value: 'telepathy' },
      { label: 'Precognitive or prophetic dream', value: 'precog_dream' },
      { label: 'Meaningful coincidence / synchronicity', value: 'synchronicity' },
      { label: 'Out-of-body experience (OBE)', value: 'obe' },
      { label: 'Near-death experience (NDE)', value: 'nde' },
      { label: 'Contact with a deceased person', value: 'contact_deceased' },
      { label: 'Spiritual or kundalini awakening', value: 'kundalini' },
      { label: 'Unexplainable experience during meditation or contemplative practice', value: 'meditation_anomalous' },
      { label: 'Other — describe in the next question', value: 'other' },
      { label: 'None of the above', value: 'none' },
    ],
  },
  {
    id: 'experienceDescription',
    question: 'Describe the experience that brought you here — especially if you selected "Other." If you selected "None," tell us what drew you to take it.',
    type: 'textarea',
    required: false,
  },
  {
    id: 'psiPossibility',
    question:
      'Do you think it is possible for humans to gain information or influence matter via psychic means?',
    type: 'slider',
    min: 0,
    max: 10,
    leftLabel: 'No, absolutely not',
    rightLabel: 'Yes, absolutely',
  },
];

// ——— POST ———

export const postQuestions = [
  {
    id: 'subjectiveSuccess',
    question: 'How "connected" did you feel to the target? (0 = none, 10 = total resonance)',
    type: 'slider',
    min: 0,
    max: 10,
    leftLabel: 'None',
    rightLabel: 'Strong Connection',
  },
  {
    id: 'focusLevel',
    question: 'How focused were you? (0 = distracted, 10 = lasered in)',
    type: 'slider',
    min: 0,
    max: 10,
    leftLabel: 'Distracted',
    rightLabel: 'Lasered In',
  },
  {
    id: 'focusStyle',
    question: 'Primary mental approach:',
    type: 'radio',
    options: [
      { label: 'Active: Pushing / Willing', value: 'active_push' },
      { label: 'Passive: Allowing / Observing', value: 'passive_allow' },
      { label: 'Meditative: Present / Non-attached', value: 'meditative' },
      { label: 'Flow / Auto-pilot: Effortless / Zoned out', value: 'flow_autopilot' }
    ],
  },
  {
    id: 'auditoryEnvironment',
    question: 'Auditory environment for this session:',
    type: 'radio',
    options: [
      { label: 'Silence', value: 'silence' },
      { label: 'Music', value: 'music' },
      { label: 'Binaural Beats / Tones', value: 'binaural' },
      { label: 'Chanting / Mantra', value: 'chanting' },
      { label: 'Ambient Noise / Other', value: 'other' }
    ],
  },
  {
    id: 'colorAffinity',
    question: 'Did you feel a pull or affinity toward one color more than the other?',
    type: 'radio',
    options: [
      { label: 'Yes — Blue', value: 'blue' },
      { label: 'Yes — Orange', value: 'orange' },
      { label: 'No', value: 'no' },
    ],
  },
  {
    id: 'finalThoughts',
    question: "Any notable physical sensations (heat, tingling) or thoughts? (optional)",
    type: 'textarea',
  },
];