/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        brand: {
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
          950: "#1e1b4b",
        },
      },
      boxShadow: {
        glow: "0 0 32px -4px rgba(99, 102, 241, 0.55), 0 0 12px -2px rgba(99, 102, 241, 0.4)",
        "glow-sm":
          "0 0 18px -4px rgba(99, 102, 241, 0.5), 0 0 6px -1px rgba(99, 102, 241, 0.35)",
        "glow-emerald":
          "0 0 32px -4px rgba(16, 185, 129, 0.5), 0 0 12px -2px rgba(16, 185, 129, 0.35)",
        "glow-emerald-sm":
          "0 0 18px -4px rgba(16, 185, 129, 0.5), 0 0 6px -1px rgba(16, 185, 129, 0.3)",
        "glow-rose":
          "0 0 32px -4px rgba(244, 63, 94, 0.55), 0 0 12px -2px rgba(244, 63, 94, 0.4)",
        "glow-rose-sm":
          "0 0 18px -4px rgba(244, 63, 94, 0.5), 0 0 6px -1px rgba(244, 63, 94, 0.35)",
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "orb-1": {
          "0%, 100%": { transform: "translate(0px, 0px) scale(1)" },
          "33%": { transform: "translate(120px, -60px) scale(1.08)" },
          "66%": { transform: "translate(-80px, 40px) scale(0.95)" },
        },
        "orb-2": {
          "0%, 100%": { transform: "translate(0px, 0px) scale(1)" },
          "33%": { transform: "translate(-100px, 80px) scale(1.1)" },
          "66%": { transform: "translate(60px, -50px) scale(0.92)" },
        },
        "orb-3": {
          "0%, 100%": { transform: "translate(0px, 0px) scale(1)" },
          "33%": { transform: "translate(70px, 90px) scale(1.05)" },
          "66%": { transform: "translate(-90px, -30px) scale(0.98)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "glow-pulse": {
          "0%, 100%": {
            boxShadow:
              "0 0 18px -4px rgba(99, 102, 241, 0.55), 0 0 6px -1px rgba(99, 102, 241, 0.35)",
          },
          "50%": {
            boxShadow:
              "0 0 36px -4px rgba(99, 102, 241, 0.75), 0 0 14px -2px rgba(99, 102, 241, 0.5)",
          },
        },
        "spin-slow": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.8)", opacity: "0.6" },
          "100%": { transform: "scale(2)", opacity: "0" },
        },
        "gradient-shift": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 420ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "scale-in": "scale-in 300ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "orb-1": "orb-1 22s ease-in-out infinite",
        "orb-2": "orb-2 25s ease-in-out infinite",
        "orb-3": "orb-3 28s ease-in-out infinite",
        shimmer: "shimmer 2.5s linear infinite",
        "glow-pulse": "glow-pulse 2.5s ease-in-out infinite",
        "spin-slow": "spin-slow 8s linear infinite",
        "pulse-ring": "pulse-ring 1.6s ease-out infinite",
        "gradient-shift": "gradient-shift 6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
