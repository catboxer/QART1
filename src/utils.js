// utils.js

// Randomly picks one item from an array
export function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Shuffles an array (not strictly needed if using only generateThreeIcons)
export function shuffleArray(array) {
  return [...array].sort(() => Math.random() - 0.5);
}

// Generates 3 unique, abstract icons for display
export function generateThreeIcons() {
  const iconOptions = [
    '⍟',
    '⌘',
    '◉',
    '◒',
    '⚆',
    '⚇',
    '⟁',
    '⩘',
    '⧖',
    '⧫',
    '⬡',
    '⧊',
    '☍',
    '⨁',
    '⦿',
    '⊙',
    '◍',
    '⧉',
  ];
  const shuffled = shuffleArray(iconOptions);
  return shuffled.slice(0, 3);
}
