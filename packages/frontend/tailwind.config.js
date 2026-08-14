/** @type {import('tailwindcss').Config} */

// Reads a CSS custom property defined as "R G B" (space-separated, no
// commas) and turns it into a Tailwind color function that still supports
// opacity modifiers like bg-critical/10. This is what lets every existing
// component (which already uses bg-surface, text-ink, border-line, etc.)
// pick up dark mode automatically once .dark is toggled on <html> —
// nothing in the components changes, only the variable values do.
function withOpacity(varName) {
  return ({ opacityValue }) => {
    if (opacityValue === undefined) return `rgb(var(${varName}))`;
    return `rgb(var(${varName}) / ${opacityValue})`;
  };
}

module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        paper: withOpacity('--color-paper'),
        surface: withOpacity('--color-surface'),
        surfaceAlt: withOpacity('--color-surfaceAlt'),
        line: withOpacity('--color-line'),
        ink: withOpacity('--color-ink'),
        body: withOpacity('--color-body'),
        dim: withOpacity('--color-dim'),
        faint: withOpacity('--color-faint'),
        accent: withOpacity('--color-accent'),
        accentSoft: withOpacity('--color-accentSoft'),
        nominal: withOpacity('--color-nominal'),
        info: withOpacity('--color-info'),
        caution: withOpacity('--color-caution'),
        critical: withOpacity('--color-critical'),
      },
      fontFamily: {
        display: ['Fraunces', 'serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
        sans: ['"IBM Plex Sans"', 'sans-serif'],
      },
      keyframes: {
        pulseDot: {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.25 },
        },
        fadeUp: {
          '0%': { opacity: 0, transform: 'translateY(10px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
      },
      animation: {
        pulseDot: 'pulseDot 1.6s ease-in-out infinite',
        fadeUp: 'fadeUp 0.6s ease-out both',
      },
    },
  },
  plugins: [],
};
