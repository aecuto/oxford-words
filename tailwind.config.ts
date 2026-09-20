import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
      keyframes: {
        shake: {
          "10%, 90%": { transform: "translateX(-2px)" },
          "20%, 80%": { transform: "translateX(4px)" },
          "30%, 50%, 70%": { transform: "translateX(-7px)" },
          "40%, 60%": { transform: "translateX(7px)" },
        },
        flash: {
          "0%": { opacity: "0.55" },
          "100%": { opacity: "0" },
        },
        floatUp: {
          "0%": { transform: "translateY(0) scale(0.7)", opacity: "0" },
          "15%": { transform: "translateY(-6px) scale(1.15)", opacity: "1" },
          "30%": { transform: "translateY(-10px) scale(1)", opacity: "1" },
          "100%": { transform: "translateY(-52px) scale(1)", opacity: "0" },
        },
        popIn: {
          "0%": { transform: "scale(0.6)", opacity: "0" },
          "70%": { transform: "scale(1.08)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
      animation: {
        shake: "shake 0.45s",
        flash: "flash 0.5s ease-out forwards",
        floatUp: "floatUp 1.05s ease-out forwards",
        popIn: "popIn 0.25s ease-out",
      },
    },
  },
  plugins: [],
};
export default config;
