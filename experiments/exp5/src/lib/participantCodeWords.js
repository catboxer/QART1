/**
 * Word list for generating single-word participant codes.
 *
 * Curated locally (not pulled from a live third-party API) so the consent
 * flow never depends on an external service being up, and so every word is
 * hand-checked: no ambiguous spelling, no homophones of another word in the
 * list, no profanity, nothing clinical or psi-adjacent that could bias a
 * participant's mindset going into the task.
 *
 * Usage note: with 300 words, a study of more than a few dozen participants
 * will see word collisions by the birthday paradox alone. Whatever generates
 * the code should check it against existing codes in storage and regenerate
 * (or append a short number, e.g. "Falcon47") on collision -- this list only
 * supplies the word half.
 */
export const PARTICIPANT_CODE_WORDS = [
  'falcon', 'otter', 'panda', 'tiger', 'zebra', 'koala', 'rabbit', 'beaver',
  'dolphin', 'penguin', 'walrus', 'badger', 'cheetah', 'gazelle', 'giraffe',
  'hedgehog', 'kangaroo', 'leopard', 'meerkat', 'ocelot', 'peacock',
  'raccoon', 'salmon', 'sparrow', 'toucan', 'wombat', 'jaguar', 'lemur',
  'mongoose', 'narwhal', 'ostrich', 'pelican', 'quokka', 'rhino', 'seal',
  'sloth', 'swan', 'turtle', 'viper', 'whale', 'yak', 'antelope', 'buffalo',
  'camel', 'cobra', 'coyote', 'crane', 'cricket', 'eagle', 'ferret',
  'firefly', 'flamingo', 'fox', 'gecko', 'goose', 'heron', 'hippo', 'hyena',
  'ibis', 'iguana', 'jackal', 'lynx', 'macaw', 'marmot', 'moose', 'newt',
  'panther', 'parrot', 'pheasant', 'possum', 'puffin', 'puma', 'quail',
  'robin', 'seahorse', 'shrimp', 'skunk', 'squid', 'stork', 'swallow',
  'tapir', 'tortoise', 'vulture', 'weasel', 'wolf', 'wren', 'bison',
  'bobcat', 'chinchilla', 'condor', 'cougar', 'crow', 'dingo', 'donkey',
  'dragonfly', 'egret', 'finch', 'fawn', 'gopher', 'grouse', 'hornbill',
  'jay', 'meadow', 'canyon', 'harbor', 'valley', 'summit', 'glacier',
  'lagoon', 'prairie', 'tundra', 'oasis', 'plateau', 'reef', 'delta',
  'grove', 'marsh', 'cliff', 'cove', 'dune', 'fjord', 'geyser', 'island',
  'jungle', 'lake', 'meadowlark', 'mesa', 'mountain', 'orchard', 'peninsula',
  'pond', 'ridge', 'river', 'savanna', 'shore', 'sky', 'spring', 'stream',
  'thicket', 'volcano', 'waterfall', 'wetland', 'aurora', 'breeze', 'cloud',
  'comet', 'dawn', 'drizzle', 'ember', 'frost', 'horizon', 'lightning',
  'meteor', 'mist', 'moonlight', 'rainbow', 'sunrise', 'sunset', 'thunder',
  'tide', 'twilight', 'wildflower', 'willow', 'amber', 'azure', 'coral',
  'crimson', 'ivory', 'indigo', 'violet', 'olive', 'teal', 'jade', 'ruby',
  'pearl', 'gold', 'silver', 'bronze', 'copper', 'cobalt', 'maroon', 'mauve',
  'lilac', 'plum', 'rose', 'sand', 'slate', 'cream', 'charcoal', 'emerald',
  'sapphire', 'topaz', 'turquoise', 'lantern', 'compass', 'anchor', 'kite',
  'ribbon', 'marble', 'puzzle', 'satchel', 'trinket', 'acorn', 'balloon',
  'banjo', 'basket', 'beacon', 'blossom', 'bramble', 'candle', 'canvas',
  'caravan', 'chestnut', 'chime', 'cinder', 'clover', 'cobblestone',
  'cocoon', 'cottage', 'cradle', 'crescent', 'crystal', 'cupcake', 'daisy',
  'domino', 'drum', 'feather', 'fiddle', 'fossil', 'garden', 'gazebo',
  'gingham', 'harmony', 'hearth', 'hollow', 'honeycomb', 'hourglass',
  'jasmine', 'juniper', 'kettle', 'lighthouse', 'lullaby', 'magnet',
  'mandolin', 'maple', 'marigold', 'melody', 'mosaic', 'nectar', 'nutmeg',
  'oak', 'orchid', 'paisley', 'pebble', 'petal', 'pinwheel', 'pinecone',
  'pocket', 'poppy', 'pumpkin', 'quartz', 'quill', 'ripple', 'sailboat',
  'satin', 'seashell', 'sequin', 'shamrock', 'sparkle', 'starlight',
  'sunflower', 'tapestry', 'telescope', 'thistle', 'thimble', 'trumpet',
  'tulip', 'umbrella', 'velvet', 'violin', 'wagon', 'walnut', 'whistle',
  'windmill', 'wishbone', 'zephyr', 'brave', 'bright', 'calm', 'clever',
  'cozy', 'curious', 'daring', 'eager', 'gentle', 'gracious', 'happy',
  'humble', 'jolly', 'joyful',
];
