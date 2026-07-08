/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        paper: '#FAF9F6',
        surface: '#FFFFFF',
        surfaceAlt: '#F2F0FB',
        line: '#E7E4F5',
        ink: '#211D45',
        body: '#4B4768',
        dim: '#8783A0',
        faint: '#B4B0C9',
        accent: '#6C5CE7',
        accentSoft: '#ECE9FE',
        nominal: '#1C9A6C',
        info: '#3B82C4',
        caution: '#B7791F',
        critical: '#C0344D',
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
