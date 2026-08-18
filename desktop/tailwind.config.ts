import type { Config } from 'tailwindcss';

/**
 * RetailOS design tokens.
 *
 * The theme centers on a near-black base with saturated dark-blue accents and
 * a small set of gradient stops used across glassmorphic surfaces. Semantic
 * aliases (surface / border / text) let components stay theme-agnostic.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Ink — the black base
        ink: {
          950: '#05070d',
          900: '#0a0d16',
          800: '#0f1220',
          700: '#151a2d',
          600: '#1c2340',
        },
        // Cobalt — the dark blue accent family
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
        // Aurora — the accent used for status positives / glowing rings
        aurora: {
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
        },
        surface: {
          DEFAULT: 'rgba(15, 18, 32, 0.72)',
          strong: 'rgba(10, 13, 22, 0.92)',
          muted: 'rgba(21, 26, 45, 0.55)',
        },
        border: {
          DEFAULT: 'rgba(255, 255, 255, 0.06)',
          strong: 'rgba(255, 255, 255, 0.12)',
        },
      },
      backgroundImage: {
        'aurora-radial':
          'radial-gradient(1200px 600px at 10% -10%, rgba(31,71,240,0.35), transparent 60%), radial-gradient(900px 500px at 100% 0%, rgba(6,182,212,0.18), transparent 60%), radial-gradient(700px 500px at 50% 120%, rgba(31,71,240,0.18), transparent 60%)',
        'grid-fade':
          'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
      },
      backgroundSize: {
        grid: '48px 48px',
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        glass:
          '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 8px 32px -8px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.04)',
        'glass-lg':
          '0 1px 0 0 rgba(255,255,255,0.08) inset, 0 24px 64px -16px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.05)',
        glow: '0 0 40px -8px rgba(31, 71, 240, 0.45)',
      },
      borderRadius: {
        xl: '0.9rem',
        '2xl': '1.25rem',
      },
      keyframes: {
        pulseSoft: {
          '0%,100%': { opacity: '0.85' },
          '50%': { opacity: '0.35' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-1000px 0' },
          '100%': { backgroundPosition: '1000px 0' },
        },
      },
      animation: {
        'pulse-soft': 'pulseSoft 2.4s ease-in-out infinite',
        shimmer: 'shimmer 2.2s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
