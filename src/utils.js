// Picks one of two values randomly
export function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Shuffles the array (used to randomize icon positions)
export function shuffleArray(array) {
  return [...array].sort(() => Math.random() - 0.5);
}

// Returns two icons: circle and square (in random order)
export function generateIconPair() {
  const iconOptions = [
    {
      id: 'circle',
      element: (
        <svg
          viewBox="0 0 100 100"
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid meet"
        >
          <circle cx="50" cy="50" r="40" fill="black" />
        </svg>
      ),
    },
    {
      id: 'square',
      element: (
        <svg
          viewBox="0 0 100 100"
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid meet"
        >
          <rect x="15" y="15" width="70" height="70" fill="black" />
        </svg>
      ),
    },
  ];

  return shuffleArray(iconOptions); // Always return both, but randomized
}
