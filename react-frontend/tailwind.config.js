/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          dark: '#1e3a5f',
          accent: '#2563eb',
        },
        cyber: {
          jet: '#0A0A0A',
          card: '#121212',
          border: '#262626',
          cerulean: '#0D7BA7',
          'cerulean-light': '#1899ce',
          neon: '#FF2D95',
          'neon-light': '#ff5ba9',
        }
      }
    },
  },
  plugins: [],
}
