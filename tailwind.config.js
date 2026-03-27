/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#fff6f7',
          100: '#ffe9ec',
          200: '#ffd3da',
          300: '#ffb3c1',
          400: '#f5879e',
          500: '#e16786',
          600: '#c94b70',
          700: '#a63a5a',
          800: '#8a324c',
          900: '#742d43',
        },
        surface: {
          50: '#f6f2f2',
          100: '#efe8e8',
          200: '#e3d9da',
          300: '#cfc0c2',
          400: '#b29da1',
          500: '#8c747a',
          600: '#6e595f',
          700: '#504247',
          800: '#352d31',
          900: '#241f22',
          950: '#171315',
        }
      }
    },
  },
  plugins: [
    function({ addUtilities }) {
      addUtilities({
        '.scrollbar-none': {
          '-ms-overflow-style': 'none',
          'scrollbar-width': 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        },
      })
    },
  ],
}
