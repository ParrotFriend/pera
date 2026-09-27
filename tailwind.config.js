/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Onest Variable"', 'system-ui', 'sans-serif'],
        display: ['"Bricolage Grotesque Variable"', '"Onest Variable"', 'system-ui', 'sans-serif']
      },
      colors: {
        ink: { DEFAULT: '#141B3C', 50: '#EEF0F8', 100: '#DCE0F0', 200: '#B7BEE0', 400: '#5B66A8', 600: '#2A3370', 700: '#1E2654', 800: '#141B3C', 900: '#0C1128' },
        paper: '#F4F6FB',
        night: { DEFAULT: '#0E1328', card: '#161C36', line: '#252D4D' },
        gain: { DEFAULT: '#0E9F6E', soft: '#DDF5EA', dark: '#34D399' },
        loss: { DEFAULT: '#D6334A', soft: '#FCE4E7', dark: '#F87185' },
        warn: { DEFAULT: '#C98A0B', soft: '#FDF1D6' },
        info: { DEFAULT: '#1C8FD1', soft: '#DDEFFA' }
      },
      boxShadow: {
        lift: '0 1px 2px rgba(20,27,60,.06), 0 8px 24px -12px rgba(20,27,60,.18)'
      }
    }
  },
  plugins: []
};
