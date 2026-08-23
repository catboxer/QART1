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
  // ── Investigator-developed exploratory items ──────────────────────────────
  {
    id: 'experienceTypes',
    question:
      'Which of the following types of experiences have you personally had or interpreted as having had? Select all that apply.',
    type: 'checkbox',
    exclusiveValues: ['none', 'prefer_not_to_answer'],
    options: [
      {
        label: 'An apparent premonition or precognitive dream',
        value: 'premonition_dream',
      },
      {
        label: 'An apparent experience of telepathy',
        value: 'telepathy',
      },
      {
        label: 'An apparent perception of a distant place or event',
        value: 'remote_perception',
      },
      {
        label:
          'An apparent influence on a physical object or system through intention',
        value: 'psychokinesis',
      },
      {
        label: 'A meaningful coincidence or synchronicity',
        value: 'synchronicity',
      },
      {
        label: 'An out-of-body or near-death experience',
        value: 'obe_nde',
      },
      {
        label: 'An apparent encounter with a deceased person',
        value: 'contact_deceased',
      },
      {
        label: 'An unusual spiritual or meditation-related experience',
        value: 'spiritual_meditation',
      },
      { label: 'Another unusual experience', value: 'other' },
      { label: 'None of the above', value: 'none' },
      { label: 'Prefer not to answer', value: 'prefer_not_to_answer' },
    ],
  },
  {
    id: 'psiPossibility',
    question:
      'How plausible did you consider the possibility that people can sometimes obtain information or influence physical systems through means that are not explained by ordinary sensory processes or currently established physical mechanisms?',
    type: 'radio',
    options: [
      { label: 'Definitely impossible', value: 'definitely_impossible' },
      { label: 'Probably impossible', value: 'probably_impossible' },
      {
        label: 'More likely impossible than possible',
        value: 'more_likely_impossible',
      },
      {
        label: 'Unsure or equally possible and impossible',
        value: 'unsure_equal',
      },
      {
        label: 'More likely possible than impossible',
        value: 'more_likely_possible',
      },
      { label: 'Probably possible', value: 'probably_possible' },
      { label: 'Definitely possible', value: 'definitely_possible' },
    ],
  },
  {
    id: 'psiAbility',
    question:
      'Regardless of how you explain your experiences, do you believe you have an ability that you can intentionally use in situations involving intuition, anomalous information, or mental influence?',
    type: 'radio',
    options: [
      { label: 'Yes, fairly consistently', value: 'yes_consistent' },
      { label: 'Yes, but inconsistently', value: 'yes_inconsistent' },
      {
        label:
          'I have had relevant experiences but do not consider them an ability',
        value: 'experiences_only',
      },
      { label: 'No', value: 'no' },
      { label: 'Unsure', value: 'unsure' },
      { label: 'Prefer not to answer', value: 'prefer_not_to_answer' },
    ],
  },
  // ── End investigator-developed exploratory items ──────────────────────────
  {
    id: 'neurodivergence',
    question:
      'Do any of the following describe how you process the world? Select all that apply.',
    type: 'checkbox',
    options: [
      { label: 'ADHD / ADD', value: 'adhd' },
      { label: 'Autism / Autism Spectrum (ASD)', value: 'autism' },
      { label: 'Dyslexia', value: 'dyslexia' },
      { label: 'Sensory Processing Differences', value: 'spd' },
      { label: 'Synesthesia', value: 'synesthesia' },
      { label: 'Highly Sensitive Person (HSP)', value: 'hsp' },
      {
        label: 'Other neurodevelopmental or perceptual difference',
        value: 'other_neuro',
      },
      { label: 'Prefer not to say', value: 'prefer_not_to_say' },
      { label: 'None of the above', value: 'none' },
    ],
  },
  // ── Multidimensional Assessment of Interoceptive Awareness, Version 2 (MAIA-2) ──────────
  // Mehling, W. E., Acree, M., Stewart, A., Silas, J., & Jones, A. (2018).
  // The Multidimensional Assessment of Interoceptive Awareness, Version 2 (MAIA-2).
  // PLoS ONE, 13(12), e0208034. (Free for research use; osher.ucsf.edu/maia)
  // Subscales: Noticing (1–4), Not-Distracting (5–10), Not-Worrying (11–15),
  //   Attention Regulation (16–22), Emotional Awareness (23–27),
  //   Self-Regulation (28–31), Body Listening (32–34), Trusting (35–37)
  // Reverse-scored items (5 − raw): see scoring notes in analysis notebooks.
  {
    id: 'maia_instruction',
    type: 'instruction',
    required: false,
    question:
      'Below you will find a list of statements. Please indicate how often each statement applies to you generally in daily life, from 0 (never) to 5 (always).',
  },
  // Noticing
  {
    id: 'maia_1',
    type: 'likert',
    question:
      'When I am tense I notice where the tension is located in my body.',
  },
  {
    id: 'maia_2',
    type: 'likert',
    question: 'I notice when I am uncomfortable in my body.',
  },
  {
    id: 'maia_3',
    type: 'likert',
    question: 'I notice where in my body I am comfortable.',
  },
  {
    id: 'maia_4',
    type: 'likert',
    question:
      'I notice changes in my breathing, such as whether it slows down or speeds up.',
  },
  // Not-Distracting (items 5–10 are reverse-scored)
  {
    id: 'maia_5',
    type: 'likert',
    question:
      'I ignore physical tension or discomfort until they become more severe.',
  },
  {
    id: 'maia_6',
    type: 'likert',
    question: 'I distract myself from sensations of discomfort.',
  },
  {
    id: 'maia_7',
    type: 'likert',
    question:
      'When I feel pain or discomfort, I try to power through it.',
  },
  { id: 'maia_8', type: 'likert', question: 'I try to ignore pain.' },
  {
    id: 'maia_9',
    type: 'likert',
    question:
      'I push feelings of discomfort away by focusing on something.',
  },
  {
    id: 'maia_10',
    type: 'likert',
    question:
      "When I feel unpleasant body sensations, I occupy myself with something else so I don't have to feel them.",
  },
  // Not-Worrying (items 11, 12, 15 are reverse-scored)
  {
    id: 'maia_11',
    type: 'likert',
    question: 'When I feel physical pain, I become upset.',
  },
  {
    id: 'maia_12',
    type: 'likert',
    question:
      'I start to worry that something is wrong if I feel any discomfort.',
  },
  {
    id: 'maia_13',
    type: 'likert',
    question:
      'I can notice an unpleasant body sensation without worrying about it.',
  },
  {
    id: 'maia_14',
    type: 'likert',
    question:
      'I can stay calm and not worry when I have feelings of discomfort or pain.',
  },
  {
    id: 'maia_15',
    type: 'likert',
    question:
      "When I am in discomfort or pain I can't get it out of my mind.",
  },
  // Attention Regulation
  {
    id: 'maia_16',
    type: 'likert',
    question:
      'I can pay attention to my breath without being distracted by things happening around me.',
  },
  {
    id: 'maia_17',
    type: 'likert',
    question:
      'I can maintain awareness of my inner bodily sensations even when there is a lot going on around me.',
  },
  {
    id: 'maia_18',
    type: 'likert',
    question:
      'When I am in conversation with someone, I can pay attention to my posture.',
  },
  {
    id: 'maia_19',
    type: 'likert',
    question: 'I can return awareness to my body if I am distracted.',
  },
  {
    id: 'maia_20',
    type: 'likert',
    question:
      'I can refocus my attention from thinking to sensing my body.',
  },
  {
    id: 'maia_21',
    type: 'likert',
    question:
      'I can maintain awareness of my whole body even when a part of me is in pain or discomfort.',
  },
  {
    id: 'maia_22',
    type: 'likert',
    question: 'I am able to consciously focus on my body as a whole.',
  },
  // Emotional Awareness
  {
    id: 'maia_23',
    type: 'likert',
    question: 'I notice how my body changes when I am angry.',
  },
  {
    id: 'maia_24',
    type: 'likert',
    question:
      'When something is wrong in my life I can feel it in my body.',
  },
  {
    id: 'maia_25',
    type: 'likert',
    question:
      'I notice that my body feels different after a peaceful experience.',
  },
  {
    id: 'maia_26',
    type: 'likert',
    question:
      'I notice that my breathing becomes free and easy when I feel comfortable.',
  },
  {
    id: 'maia_27',
    type: 'likert',
    question:
      'I notice how my body changes when I feel happy / joyful.',
  },
  // Self-Regulation
  {
    id: 'maia_28',
    type: 'likert',
    question:
      'When I feel overwhelmed I can find a calm place inside.',
  },
  {
    id: 'maia_29',
    type: 'likert',
    question:
      'When I bring awareness to my body I feel a sense of calm.',
  },
  {
    id: 'maia_30',
    type: 'likert',
    question: 'I can use my breath to reduce tension.',
  },
  {
    id: 'maia_31',
    type: 'likert',
    question:
      'When I am caught up in thoughts, I can calm my mind by focusing on my body/breathing.',
  },
  // Body Listening
  {
    id: 'maia_32',
    type: 'likert',
    question:
      'I listen for information from my body about my emotional state.',
  },
  {
    id: 'maia_33',
    type: 'likert',
    question:
      'When I am upset, I take time to explore how my body feels.',
  },
  {
    id: 'maia_34',
    type: 'likert',
    question: 'I listen to my body to inform me about what to do.',
  },
  // Trusting
  {
    id: 'maia_35',
    type: 'likert',
    question: 'I am at home in my body.',
  },
  {
    id: 'maia_36',
    type: 'likert',
    question: 'I feel my body is a safe place.',
  },
  {
    id: 'maia_37',
    type: 'likert',
    question: 'I trust my body sensations.',
  },
  // ── End MAIA-2 ───────────────────────────────────────────────────────────

  // ── Boundary Questionnaire – 18-item short form (BQ-18) ──────────────────
  // Hartmann, E. (1991). Boundaries in the Mind. Basic Books.
  // Short form: Kunzendorf, R. G., et al. — confirm exact citation with Andrea.
  // Scoring: BQ18_total = sum of all 18 items (range 0–72).
  //   Higher scores = thinner boundaries = greater permeability.
  //   No reverse-scored items (confirm from item sheet).
  //   Z-score across the analyzed sample in the notebook; use for exploratory
  //   correlations only (spearmanr vs minus_log_p_swap, abs_H_deviation).
  // NOTE: 19 items were supplied; verify against Andrea's source sheet — one
  //   may need to be dropped to match the 18-item canonical form.
  {
    id: 'bq18_instruction',
    type: 'instruction',
    required: false,
    question:
      'Please rate each of the following statements from 0 to 4.\n0 = Not at all true of me; 4 = Very true of me.\nTry to respond as quickly as you can.',
  },
  {
    id: 'bq18_1',
    type: 'likert',
    scale: [0, 1, 2, 3, 4],
    leftAnchor: 'Not at all',
    rightAnchor: 'Very true',
    question: 'My feelings blend into one another.',
  },
  {
    id: 'bq18_2',
    type: 'likert',
    scale: [0, 1, 2, 3, 4],
    leftAnchor: 'Not at all',
    rightAnchor: 'Very true',
    question: 'I am very close to my childhood feelings.',
  },
  {
    id: 'bq18_3',
    type: 'likert',
    scale: [0, 1, 2, 3, 4],
    leftAnchor: 'Not at all',
    rightAnchor: 'Very true',
    question: 'I am easily hurt.',
  },
  {
    id: 'bq18_4',
    type: 'likert',
    scale: [0, 1, 2, 3, 4],
    leftAnchor: 'Not at all',
    rightAnchor: 'Very true',
    question:
      'I spend a lot of time daydreaming, fantasizing, or in reverie.',
  },
  {
    id: 'bq18_5',
    type: 'likert',
    scale: [0, 1, 2, 3, 4],
    leftAnchor: 'Not at all',
    rightAnchor: 'Very true',
    question:
      "Sometimes it's scary when one gets too involved with another person.",
  },
  {
    id: 'bq18_6',
    type: 'likert',
    scale: [0, 1, 2, 3, 4],
    leftAnchor: 'Not at all',
    rightAnchor: 'Very true',
    question: 'A good parent has to be a bit of a child too.',
  },
  {
    id: 'bq18_7',
    type: 'likert',
    scale: [0, 1, 2, 3, 4],
    leftAnchor: 'Not at all',
    rightAnchor: 'Very true',
    question:
      'I can easily imagine myself as an animal or what it might be like to be an animal.',
  },
  {
    id: 'bq18_8',
    type: 'likert',
    scale: [0, 1, 2, 3, 4],
    leftAnchor: 'Not at all',
    rightAnchor: 'Very true',
    question:
      'When something happens to a friend of mine or to a lover, it is almost as if it happened to me.',
  },
  {
    id: 'bq18_9',
    type: 'likert',
    scale: [0, 1, 2, 3, 4],
    leftAnchor: 'Not at all',
    rightAnchor: 'Very true',
    question:
      "When I work on a project I don't like to tie myself down to a definite outline. I rather like to let my mind wander",
  },
  {
    id: 'bq18_10',
    type: 'likert',
    scale: [0, 1, 2, 3, 4],
    leftAnchor: 'Not at all',
    rightAnchor: 'Very true',
    question:
      'In my dreams, people sometimes merge into each other or become other people.',
  },
  {
    id: 'bq18_11',
    type: 'likert',
    scale: [0, 1, 2, 3, 4],
    leftAnchor: 'Not at all',
    rightAnchor: 'Very true',
    question:
      'I believe I am influenced by forces that no one can understand.',
  },
  {
    id: 'bq18_12',
    type: 'likert',
    scale: [0, 1, 2, 3, 4],
    leftAnchor: 'Not at all',
    rightAnchor: 'Very true',
    question:
      'There are no sharp dividing lines between normal people, people with problems, and people who are considered psychotic or crazy.',
  },
  {
    id: 'bq18_13',
    type: 'likert',
    scale: [0, 1, 2, 3, 4],
    leftAnchor: 'Not at all',
    rightAnchor: 'Very true',
    question:
      'I think I would enjoy being some kind of creative artist.',
  },
  {
    id: 'bq18_14',
    type: 'likert',
    scale: [0, 1, 2, 3, 4],
    leftAnchor: 'Not at all',
    rightAnchor: 'Very true',
    question:
      'I have had the experience of someone calling me or speaking my name and not being sure whether it was really happening or whether I was imagining it.',
  },
  // thick-boundary items (higher scores = thicker boundaries on these; no reverse-scoring per spec — confirm)
  {
    id: 'bq18_15',
    type: 'likert',
    scale: [0, 1, 2, 3, 4],
    leftAnchor: 'Not at all',
    rightAnchor: 'Very true',
    question:
      'I like stories that have a definite beginning, middle, and end.',
  },
  {
    id: 'bq18_16',
    type: 'likert',
    scale: [0, 1, 2, 3, 4],
    leftAnchor: 'Not at all',
    rightAnchor: 'Very true',
    question:
      'A good organization is one in which all the lines of responsibility are precise and clearly established.',
  },
  {
    id: 'bq18_17',
    type: 'likert',
    scale: [0, 1, 2, 3, 4],
    leftAnchor: 'Not at all',
    rightAnchor: 'Very true',
    question:
      'There is a place for everything, and everything should be in its place.',
  },
  {
    id: 'bq18_18',
    type: 'likert',
    scale: [0, 1, 2, 3, 4],
    leftAnchor: 'Not at all',
    rightAnchor: 'Very true',
    question: 'I am a down-to-earth, no-nonsense kind of person.',
  },
  // ── End BQ-18 ────────────────────────────────────────────────────────────

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
