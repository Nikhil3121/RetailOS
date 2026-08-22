/**
 * NativeWind + Tailwind config for the mobile app.
 *
 * Shares the SAME colour tokens as the desktop app (desktop/tailwind.config.ts)
 * so a "bg-ink-900" pixel on Android matches the "bg-ink-900" pixel in Electron.
 * When the design system evolves, keep the two files in sync until we promote
 * both into a shared package/core (see mobile/README.md → monorepo section).
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#05070d',
          900: '#0a0d16',
          800: '#0f1220',
          700: '#151a2d',
          600: '#1c2340',
        },
        cobalt: {
          50: '#eaf2ff',
          100: '#c9dbff',
          200: '#95b6ff',
          300: '#5f8aff',
          400: '#3865ff',
          500: '#1f47f0',
          600: '#1637c4',
          700: '#122c9c',
          800: '#0e2378',
          900: '#0a1a5c',
          950: '#060f38',
        },
        aurora: {
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
        },
      },
    },
  },
  plugins: [],
};
