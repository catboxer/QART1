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
    options: ['Female', 'Male', 'Nonbinary', 'Prefer not to answer'],
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
      'Prefer not to answer',
    ],
  },
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
      { label: 'Prefer not to answer', value: 'prefer_not_to_answer' },
      { label: 'None of the above', value: 'none' },
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
  {
    id: 'psiPossibility',
    question:
      'Before participating in this study, how plausible did you consider the possibility that human intention could influence the output of a genuinely random physical system?',
    type: 'radio',
    // Values are the scoring codes (0 = prefer not to answer); only labels are shown.
    options: [
      { label: 'Definitely impossible', value: 1 },
      { label: 'Probably impossible', value: 2 },
      { label: 'More likely impossible than possible', value: 3 },
      { label: 'Unsure or equally possible and impossible', value: 4 },
      { label: 'More likely possible than impossible', value: 5 },
      { label: 'Probably possible', value: 6 },
      { label: 'Definitely possible', value: 7 },
      { label: 'Prefer not to answer', value: 0 },
    ],
  },
  // ── End investigator-developed exploratory items ──────────────────────────
  // ── Sensory-sensitivity scale (18 items, 1–7) ───────────────────────────────
  {
    id: 'hsp_instruction',
    type: 'instruction',
    required: false,
    question:
      'Please rate each question from 1 to 7.\n\n1 = Not at all\n2 = Very little\n3 = Slightly\n4 = Moderately\n5 = Quite a bit\n6 = Very much\n7 = Extremely',
  },
  {
    id: 'hsp_1',
    type: 'likert',
    scale: [1, 2, 3, 4, 5, 6, 7],
    leftAnchor: 'Not at all',
    rightAnchor: 'Extremely',
    question: "Do you notice when things have been moved around?",
  },
  {
    id: 'hsp_2',
    type: 'likert',
    scale: [1, 2, 3, 4, 5, 6, 7],
    leftAnchor: 'Not at all',
    rightAnchor: 'Extremely',
    question: "Are you easily affected by feedback (both negative and positive)?",
  },
  {
    id: 'hsp_3',
    type: 'likert',
    scale: [1, 2, 3, 4, 5, 6, 7],
    leftAnchor: 'Not at all',
    rightAnchor: 'Extremely',
    question: "Are you easily overwhelmed by things like bright lights, strong smells, coarse fabrics, or sirens close by?",
  },
  {
    id: 'hsp_4',
    type: 'likert',
    scale: [1, 2, 3, 4, 5, 6, 7],
    leftAnchor: 'Not at all',
    rightAnchor: 'Extremely',
    question: "Do you easily recognise what others are feeling?",
  },
  {
    id: 'hsp_5',
    type: 'likert',
    scale: [1, 2, 3, 4, 5, 6, 7],
    leftAnchor: 'Not at all',
    rightAnchor: 'Extremely',
    question: "Do you notice and enjoy delicate or fine scents, tastes, sounds, works of art?",
  },
  {
    id: 'hsp_6',
    type: 'likert',
    scale: [1, 2, 3, 4, 5, 6, 7],
    leftAnchor: 'Not at all',
    rightAnchor: 'Extremely',
    question: "Are you easily affected by the mood of people around you?",
  },
  {
    id: 'hsp_7',
    type: 'likert',
    scale: [1, 2, 3, 4, 5, 6, 7],
    leftAnchor: 'Not at all',
    rightAnchor: 'Extremely',
    question: "Do you tend to reflect on things deeply?",
  },
  {
    id: 'hsp_8',
    type: 'likert',
    scale: [1, 2, 3, 4, 5, 6, 7],
    leftAnchor: 'Not at all',
    rightAnchor: 'Extremely',
    question: "Are you good at anticipating how someone may feel about a situation?",
  },
  {
    id: 'hsp_9',
    type: 'likert',
    scale: [1, 2, 3, 4, 5, 6, 7],
    leftAnchor: 'Not at all',
    rightAnchor: 'Extremely',
    question: "Are you bothered by intense stimuli, like loud noises or chaotic scenes?",
  },
  {
    id: 'hsp_10',
    type: 'likert',
    scale: [1, 2, 3, 4, 5, 6, 7],
    leftAnchor: 'Not at all',
    rightAnchor: 'Extremely',
    question: "Do you generally react strongly to your experiences, whether you show it or not?",
  },
  {
    id: 'hsp_11',
    type: 'likert',
    scale: [1, 2, 3, 4, 5, 6, 7],
    leftAnchor: 'Not at all',
    rightAnchor: 'Extremely',
    question: "Do other people tell you that you are good at understanding what they are feeling or thinking?",
  },
  {
    id: 'hsp_12',
    type: 'likert',
    scale: [1, 2, 3, 4, 5, 6, 7],
    leftAnchor: 'Not at all',
    rightAnchor: 'Extremely',
    question: "Do you tend to get deeply immersed in music?",
  },
  {
    id: 'hsp_13',
    type: 'likert',
    scale: [1, 2, 3, 4, 5, 6, 7],
    leftAnchor: 'Not at all',
    rightAnchor: 'Extremely',
    question: "Do you find yourself thinking about philosophical questions?",
  },
  {
    id: 'hsp_14',
    type: 'likert',
    scale: [1, 2, 3, 4, 5, 6, 7],
    leftAnchor: 'Not at all',
    rightAnchor: 'Extremely',
    question: "Do you seem to notice changes in the weather more than others do?",
  },
  {
    id: 'hsp_15',
    type: 'likert',
    scale: [1, 2, 3, 4, 5, 6, 7],
    leftAnchor: 'Not at all',
    rightAnchor: 'Extremely',
    question: "Do you become unpleasantly aroused when a lot is going on around you?",
  },
  {
    id: 'hsp_16',
    type: 'likert',
    scale: [1, 2, 3, 4, 5, 6, 7],
    leftAnchor: 'Not at all',
    rightAnchor: 'Extremely',
    question: "Are you deeply moved by the arts or music?",
  },
  {
    id: 'hsp_17',
    type: 'likert',
    scale: [1, 2, 3, 4, 5, 6, 7],
    leftAnchor: 'Not at all',
    rightAnchor: 'Extremely',
    question: "Do you tend to notice subtle signs of changing seasons (winter/spring etc.)?",
  },
  {
    id: 'hsp_18',
    type: 'likert',
    scale: [1, 2, 3, 4, 5, 6, 7],
    leftAnchor: 'Not at all',
    rightAnchor: 'Extremely',
    question: "Do you like deep conversations?",
  },
  // ── Subtle-attunement items (investigator-developed; 1–7) ──
  {
    id: 'attune_instruction',
    type: 'instruction',
    required: false,
    question:
      'Please rate how true each statement is of you, using the same 1 to 7 scale.',
  },
  {
    id: 'attune_1',
    type: 'likert',
    scale: [1, 2, 3, 4, 5, 6, 7],
    leftAnchor: 'Not at all',
    rightAnchor: 'Extremely',
    question: "I register the presence of objects in a room even without looking directly at them.",
  },
  {
    id: 'attune_2',
    type: 'likert',
    scale: [1, 2, 3, 4, 5, 6, 7],
    leftAnchor: 'Not at all',
    rightAnchor: 'Extremely',
    question: "I notice small irregularities in patterns or symmetry around me without trying to.",
  },
  {
    id: 'attune_3',
    type: 'likert',
    scale: [1, 2, 3, 4, 5, 6, 7],
    leftAnchor: 'Not at all',
    rightAnchor: 'Extremely',
    question: "I pick up on things at the edge of my attention without trying.",
  },
  {
    id: 'attune_4',
    type: 'likert',
    scale: [1, 2, 3, 4, 5, 6, 7],
    leftAnchor: 'Not at all',
    rightAnchor: 'Extremely',
    question: "I sometimes know something has changed before I can identify what.",
  },
  {
    id: 'attune_5',
    type: 'likert',
    scale: [1, 2, 3, 4, 5, 6, 7],
    leftAnchor: 'Not at all',
    rightAnchor: 'Extremely',
    question: "I notice when my body is responding to something before I consciously register it.",
  },
  // ── Revised Transliminality Scale (29 items, true/false) ────────────────────
  // Scored items (analysis only; not shown to participants):
  //   2, 3, 4, 5, 8, 9, 12, 13, 16, 18, 19, 20, 21, 22, 25, 26, 29
  // Displayed but unscored: all other items.
  {
    id: 'rts_instruction',
    type: 'instruction',
    required: false,
    question: 'The following statements are true or false. Please choose True or False for each.',
  },
  {
    id: 'rts_1',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "Horoscopes are right too often for it to be coincidence.",
  },
  {
    id: 'rts_2',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "At times I perform certain little rituals to ward off negative influences.",
  },
  {
    id: 'rts_3',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "I have experienced an altered state of consciousness in which I felt that I became cosmically enlightened.",
  },
  {
    id: 'rts_4',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "At the present time, I am very good at make-believe and imagining.",
  },
  {
    id: 'rts_5',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "I have felt that I had received special wisdom, to be communicated to the rest of humanity.",
  },
  {
    id: 'rts_6',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "I have sometimes behaved in a much more impulsive or uninhibited way than is usual for me.",
  },
  {
    id: 'rts_7',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "I am fascinated by new ideas, whether or not they have a practical value.",
  },
  {
    id: 'rts_8',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "I have sometimes sensed an evil presence around me, although I could not see it.",
  },
  {
    id: 'rts_9',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "My thoughts have sometimes come so quickly that I could not write them all down fast enough.",
  },
  {
    id: 'rts_10',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "If I could not pretend or make-believe anymore, I would not be me - I would not be the same person.",
  },
  {
    id: 'rts_11',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "Sometimes I experience things as if they were doubly real.",
  },
  {
    id: 'rts_12',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "It is sometimes possible for me to be completely immersed in nature or in art and to feel as if my whole state of consciousness has somehow temporarily been altered.",
  },
  {
    id: 'rts_13',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "Often I have a day when indoor lights seem so bright that they bother my eyes.",
  },
  {
    id: 'rts_14',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "I am convinced that I have had at least one experience of telepathy between myself and another person.",
  },
  {
    id: 'rts_15',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "I am convinced that I am psychic.",
  },
  {
    id: 'rts_16',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "I have experienced an altered state of consciousness which I believe utterly transformed, in a positive manner, the way I looked at myself.",
  },
  {
    id: 'rts_17',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "I am convinced that I have had a premonition about the future that came true and which I believe was not just a coincidence.",
  },
  {
    id: 'rts_18',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "I think that I really know what some people mean when they talk about mystical experiences.",
  },
  {
    id: 'rts_19',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "I have gone through times when smells seemed stronger and more overwhelming than usual.",
  },
  {
    id: 'rts_20',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "I can clearly feel again in my imagination such things as the feeling of a gentle breeze, warm sand under bare feet, the softness of fur, cool grass, the warmth of the sun, and the smell of freshly cut grass.",
  },
  {
    id: 'rts_21',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "A person should try to understand their dreams and be guided by or take warnings from them.",
  },
  {
    id: 'rts_22',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "While listening to my favourite music, in addition to feeling calm, relaxed, happy, etc., I often have a feeling of oneness with the music, or of being in another place or time, or vividly remembering the past.",
  },
  {
    id: 'rts_23',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "At times I somehow feel the presence of someone who is not physically there.",
  },
  {
    id: 'rts_24',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "I am convinced that it is possible to gain information about the thoughts, feelings, or circumstances of another person in a way that does not depend on rational prediction or normal sensory channels.",
  },
  {
    id: 'rts_25',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "For several days at a time I have had such a heightened awareness of sights and sounds that I cannot shut them out.",
  },
  {
    id: 'rts_26',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "I sometimes have a feeling of gaining or losing energy when certain people look at me or touch me.",
  },
  {
    id: 'rts_27',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "Now that I am grown up, I still in some ways believe in such beings as elves, witches, leprechauns, fairies, etc.",
  },
  {
    id: 'rts_28',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "Sometimes people think I am a bit weird because my ideas are so novel.",
  },
  {
    id: 'rts_29',
    type: 'radio',
    options: [
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' },
    ],
    question: "When listening to organ music or other powerful music, I sometimes feel as if I am being lifted up into the air.",
  },
  // ── Boundary Questionnaire – 18-item short form (BQ-18) ──────────────────
  // Hartmann, E. (1991). Boundaries in the Mind. Basic Books.
  // Short form: Kunzendorf, R. G., et al. — confirm exact citation with Andrea.
  // Scoring: BQ18_total = sum of all 18 items (range 0–72).
  //   Higher scores = thinner boundaries = greater permeability.
  //   No reverse-scored items (confirm from item sheet).
  //   Z-score across the analyzed sample in the notebook; use for exploratory
  //   correlations only (spearmanr vs minus_log_p_swap, abs_H_deviation).
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
      { label: 'Prefer not to answer', value: 'prefer_not_to_answer' },
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
      { label: 'Prefer not to answer', value: 'prefer_not_to_answer' },
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
      { label: 'Prefer not to answer', value: 'prefer_not_to_answer' },
    ],
  },
  {
    id: 'finalThoughts',
    question:
      'Any notable physical sensations (heat, tingling) or thoughts? (optional)',
    type: 'textarea',
  },
];
