/** @type {import('tailwindcss').Config} */

/*
 * DESIGN DIRECTION — "Graphite & Signal"
 *
 * The previous theme was indigo-to-fuchsia gradients, neon glow shadows, three
 * drifting background orbs, shimmer sweeps and animated gradient text. That is
 * the look a project gets when nobody chose one, and it is why the app read as
 * generated rather than designed.
 *
 * The replacement has one idea: the interface is monochrome graphite, and
 * COLOUR MEANS SOMETHING. A coloured element is either the primary action or a
 * status. Nothing is coloured for decoration. When everything glows, nothing
 * signals — that is the whole problem with the old theme in one sentence.
 *
 * `brand` is deliberately kept as the scale name so the 119 existing
 * `brand-*` usages across 34 files re-point to the new accent without touching
 * a single component. The accent is a warm gold, chosen because it sits
 * against cool graphite with real tension and because it cannot be mistaken
 * for the indigo every generated dashboard ships with.
 *
 * `shadow-glow*` is likewise kept as a name and redefined as genuine elevation,
 * so the 21 existing usages become depth instead of neon.
 */
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
        // The accent. Warm gold against cool graphite.
        brand: {
          200: "#F7E0A8",
          300: "#F2C765",
          400: "#E8B84B",
          500: "#E0A62F",
          600: "#C08820",
          700: "#96691A",
          800: "#6B4B14",
          900: "#45300D",
          950: "#241906",
        },
        // The architecture. A slightly cool neutral ramp — warmer greys read
        // as sepia at these values, and colder ones as clinical blue.
        graphite: {
          50: "#F4F5F6",
          100: "#E6E7EA",
          200: "#C9CBD1",
          300: "#A2A6AD",
          400: "#767A83",
          500: "#565A63",
          600: "#3C3F46",
          700: "#2A2C31",
          800: "#1A1C1F",
          900: "#131416",
          950: "#0B0C0D",
        },
      },
      boxShadow: {
        // Elevation, not neon. Dark shadows on a dark ground read as depth;
        // coloured ones read as a light source that is not in the scene.
        glow: "0 8px 24px -8px rgba(0,0,0,0.7), 0 2px 6px -2px rgba(0,0,0,0.5)",
        "glow-sm": "0 2px 8px -2px rgba(0,0,0,0.6)",
        "glow-emerald": "0 8px 24px -8px rgba(0,0,0,0.7)",
        "glow-emerald-sm": "0 2px 8px -2px rgba(0,0,0,0.6)",
        "glow-rose": "0 8px 24px -8px rgba(0,0,0,0.7)",
        "glow-rose-sm": "0 2px 8px -2px rgba(0,0,0,0.6)",
        panel: "0 1px 2px rgba(0,0,0,0.4)",
      },
      keyframes: {
        /*
         * Only two remain, and both are entrances — they mark that something
         * arrived. The deleted ones (orb-1/2/3, shimmer, glow-pulse,
         * gradient-shift, spin-slow) all animated forever without ever
         * reporting anything, which is decoration pretending to be feedback.
         *
         * `pulse-ring` is kept: it marks live recording, which is a real state
         * that genuinely is ongoing.
         */
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.99)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.85)", opacity: "0.5" },
          "100%": { transform: "scale(1.9)", opacity: "0" },
        },
      },
      animation: {
        // Short enough to feel like a response rather than a transition.
        "fade-in-up": "fade-in-up 160ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "scale-in": "scale-in 140ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "pulse-ring": "pulse-ring 1.6s ease-out infinite",
      },
      borderRadius: {
        // Consumer apps round to 16px+. Instruments do not.
        xl: "0.5rem",
        "2xl": "0.625rem",
        "3xl": "0.75rem",
      },
    },
  },
  plugins: [],
};
