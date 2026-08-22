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
    question:
      'What is your level of experience with meditation or deep-focus practice?',
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
    question:
      'Which of the following have you experienced? Select all that apply.',
    type: 'checkbox',
    withFrequency: true,
    frequencyId: 'experienceFrequency',
    options: [
      {
        label:
          'Precognition — knowing something before you could have known it',
        value: 'precognition',
      },
      {
        label:
          'Remote viewing — perceiving a distant location or object',
        value: 'remote_viewing',
      },
      {
        label: 'Telepathy — direct mind-to-mind communication',
        value: 'telepathy',
      },
      {
        label:
          'Psychokinesis — influencing physical objects or systems with the mind',
        value: 'psychokinesis',
      },
      {
        label: 'Precognitive or prophetic dream',
        value: 'precog_dream',
      },
      {
        label: 'Meaningful coincidence / synchronicity',
        value: 'synchronicity',
      },
      { label: 'Out-of-body experience (OBE)', value: 'obe' },
      { label: 'Near-death experience (NDE)', value: 'nde' },
      {
        label: 'Contact with a deceased person',
        value: 'contact_deceased',
      },
      {
        label: 'Spiritual or kundalini awakening',
        value: 'kundalini',
      },
      {
        label:
          'Unexplainable experience during meditation or contemplative practice',
        value: 'meditation_anomalous',
      },
      {
        label: 'Other — describe in the next question',
        value: 'other',
      },
      { label: 'None of the above', value: 'none' },
    ],
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
  {
    id: 'psiConfidence',
    question:
      'Do you have a psychic ability that you can actively use?',
    type: 'radio',
    options: [
      {
        label: 'Yes, I have an ability I can actively use',
        value: 'yes_active',
      },
      {
        label: "Yes, but it's inconsistent or unreliable",
        value: 'yes_inconsistent',
      },
      {
        label: "I've had experiences but wouldn't call it a skill",
        value: 'experiences_only',
      },
      { label: 'No', value: 'no' },
    ],
  },
  {
    id: 'psiFrequency',
    question: 'How often do you exercise or practice this ability?',
    type: 'slider',
    min: 0,
    max: 10,
    leftLabel: 'Rarely / never',
    rightLabel: 'Very often / daily',
    showIf: { id: 'psiConfidence', values: ['yes_active', 'yes_inconsistent', 'experiences_only'] },
  },
];

// ——— POST ———

export const postQuestions = [
  {
    id: 'subjectiveSuccess',
    question:
      'How "connected" did you feel to the target? (0 = none, 10 = total resonance)',
    type: 'slider',
    min: 0,
    max: 10,
    leftLabel: 'None',
    rightLabel: 'Strong Connection',
  },
  {
    id: 'focusLevel',
    question:
      'How focused were you? (0 = distracted, 10 = lasered in)',
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
      {
        label: 'Passive: Allowing / Observing',
        value: 'passive_allow',
      },
      {
        label: 'Meditative: Present / Non-attached',
        value: 'meditative',
      },
      {
        label: 'Flow / Auto-pilot: Effortless / Zoned out',
        value: 'flow_autopilot',
      },
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
      { label: 'Ambient Noise / Other', value: 'other' },
    ],
  },
  {
    id: 'focusTarget',
    question: 'During this session, where was your primary focus?',
    type: 'radio',
    options: [
      {
        label: 'I focused primarily on my target color',
        value: 'target_color',
      },
      {
        label: 'I focused primarily on achieving a high score',
        value: 'high_score',
      },
      { label: 'I focused equally on both', value: 'both' },
      {
        label: "I didn't focus strongly on either",
        value: 'neither',
      },
    ],
  },
  {
    id: 'finalThoughts',
    question:
      'Any notable physical sensations (heat, tingling) or thoughts? (optional)',
    type: 'textarea',
  },
];
