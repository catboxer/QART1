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
// SVG icon components
export function generateThreeIcons() {
  const iconOptions = [
    {
      id: 'circle',
      element: (
        <svg width="30" height="30">
          <circle cx="15" cy="15" r="10" fill="black" />
        </svg>
      ),
    },
    {
      id: 'square',
      element: (
        <svg width="30" height="30">
          <rect x="5" y="5" width="20" height="20" fill="black" />
        </svg>
      ),
    },
    {
      id: 'triangle-up',
      element: (
        <svg width="30" height="30">
          <polygon points="15,5 25,25 5,25" fill="black" />
        </svg>
      ),
    },
    {
      id: 'triangle-down',
      element: (
        <svg width="30" height="30">
          <polygon points="5,5 25,5 15,25" fill="black" />
        </svg>
      ),
    },
    {
      id: 'diamond',
      element: (
        <svg width="30" height="30">
          <polygon points="15,0 30,15 15,30 0,15" fill="black" />
        </svg>
      ),
    },
    {
      id: 'hexagon',
      element: (
        <svg width="30" height="30">
          <polygon
            points="15,5 25,12.5 25,22.5 15,30 5,22.5 5,12.5"
            fill="black"
          />
        </svg>
      ),
    },
    {
      id: 'star',
      element: (
        <svg width="30" height="30">
          <polygon
            points="15,0 18,10 28,10 20,16 24,26 15,20 6,26 10,16 2,10 12,10"
            fill="black"
          />
        </svg>
      ),
    },
    {
      id: 'cross',
      element: (
        <svg width="30" height="30">
          <rect x="13" y="5" width="4" height="20" fill="black" />
          <rect x="5" y="13" width="20" height="4" fill="black" />
        </svg>
      ),
    },
    {
      id: 'pacman',
      element: (
        <svg width="30" height="30">
          <path d="M15,15 L25,5 A10,10 0 1,1 5,15 Z" fill="black" />
        </svg>
      ),
    },
    {
      id: 'moon',
      element: (
        <svg width="30" height="30">
          <path
            d="M20,15 A10,10 0 1,1 10,5 A7,7 0 1,0 20,15"
            fill="black"
          />
        </svg>
      ),
    },
    {
      id: 'grid',
      element: (
        <svg width="30" height="30">
          {[0, 7, 14].map((y) =>
            [0, 7, 14].map((x, i) => (
              <rect
                key={`${x}-${y}-${i}`}
                x={5 + x}
                y={5 + y}
                width="4"
                height="4"
                fill="black"
              />
            ))
          )}
        </svg>
      ),
    },
    {
      id: 'ring',
      element: (
        <svg width="30" height="30">
          <circle cx="15" cy="15" r="10" fill="black" />
          <circle cx="15" cy="15" r="5" fill="white" />
        </svg>
      ),
    },
    {
      id: 'notched-box',
      element: (
        <svg width="30" height="30">
          <path d="M5,5 h20 v5 h-5 v5 h5 v10 h-20 z" fill="black" />
        </svg>
      ),
    },
    {
      id: 'pill',
      element: (
        <svg width="30" height="30">
          <rect
            x="5"
            y="10"
            rx="10"
            ry="10"
            width="20"
            height="10"
            fill="black"
          />
        </svg>
      ),
    },
    {
      id: 'chevron-up',
      element: (
        <svg width="30" height="30">
          <polyline
            points="5,20 15,10 25,20"
            fill="none"
            stroke="black"
            strokeWidth="4"
          />
        </svg>
      ),
    },
    {
      id: 'chevron-down',
      element: (
        <svg width="30" height="30">
          <polyline
            points="5,10 15,20 25,10"
            fill="none"
            stroke="black"
            strokeWidth="4"
          />
        </svg>
      ),
    },
    {
      id: 'x-shape',
      element: (
        <svg width="30" height="30">
          <line
            x1="5"
            y1="5"
            x2="25"
            y2="25"
            stroke="black"
            strokeWidth="4"
          />
          <line
            x1="25"
            y1="5"
            x2="5"
            y2="25"
            stroke="black"
            strokeWidth="4"
          />
        </svg>
      ),
    },
    {
      id: 'half-circle',
      element: (
        <svg width="30" height="30">
          <path
            d="M5,15 A10,10 0 0,1 25,15 L25,30 L5,30 Z"
            fill="black"
          />
        </svg>
      ),
    },
  ];

  const shuffled = shuffleArray(iconOptions);
  return shuffled.slice(0, 3);
}
