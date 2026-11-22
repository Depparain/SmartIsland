/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        island: {
          bg: "rgba(10, 10, 12, 0.88)",
          card: "rgba(255, 255, 255, 0.05)",
          border: "rgba(255, 255, 255, 0.12)",
          accent: "#38bdf8",
        }
      },
      fontFamily: {
        sans: ["Segoe UI Variable Display", "Segoe UI", "-apple-system", "sans-serif"],
      }
    },
  },
  plugins: [],
}
