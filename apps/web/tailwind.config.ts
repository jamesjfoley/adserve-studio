import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#E6F1FB",
          100: "#B5D4F4",
          200: "#85B7EB",
          300: "#5A9AE1",
          400: "#378ADD",
          500: "#185FA5",
          600: "#0C447C",
          700: "#042C53",
        },
      },
    },
  },
  plugins: [],
};

export default config;
