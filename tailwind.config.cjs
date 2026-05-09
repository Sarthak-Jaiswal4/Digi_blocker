/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        neo: '6px 6px 0px rgba(0,0,0,1)'
      },
      borderWidth: {
        3: '3px'
      }
    }
  },
  plugins: []
};

