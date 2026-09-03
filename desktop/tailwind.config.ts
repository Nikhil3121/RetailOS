import type { Config } from 'tailwindcss';

/**
 * JR Retail OS design tokens.
 *
 * Semantic aliases (surface / border / ink) let components stay
 * theme-agnostic: one token set serves both light and dark.
 */

/**
 * BRAND — orange, taken from the logo.
 *
 * The mark is navy and orange, so the interface now uses the same two colours:
 * navy for structure and surfaces, orange for the one action on each screen.
 *
 * This also gives GREEN BACK ITS MEANING. On a screen showing money, green
 * should say paid / settled / in credit and red should say due / overdue.
 * While green was the button colour, a green "Save" and a green "Paid" chip
 * spoke in the same voice about entirely different things.
 *
 * Orange behaves like green under the contrast rules — bright, so the fill has
 * to run deep before white text is legible on it. 600 (#b24f0d) carries white
 * at 5.23:1; on the navy panel, 400 reads at 7.52:1 and 300 at 10.29:1.
 */
const BRAND = {
  50: '#fef4ee',
  100: '#fde7d8',
  200: '#fcd0b3',
  300: '#f8af7f',
  400: '#f3873f',
  500: '#e16411',
  600: '#b24f0d',
  700: '#95430b',
  800: '#76360c',
  900: '#5d2c0c',
  950: '#331907',
} as const;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        /**
         * Ink — the app's ground and its raised surfaces.
         *
         * Variable-driven so one token set serves both themes. This is what
         * replaced 60 `!important` overrides: the sidebar, titlebar and every
         * panel now take their colour from the same place as everything else.
         */
        ink: {
          950: 'rgb(var(--app-bg) / <alpha-value>)',
          900: 'rgb(var(--panel) / <alpha-value>)',
          800: 'rgb(var(--panel) / <alpha-value>)',
          700: 'rgb(var(--panel-2) / <alpha-value>)',
          600: 'rgb(var(--panel-2) / <alpha-value>)',
        },
        // Cobalt — the dark blue accent family
        /**
         * BRAND — green, built as a real ramp.
         *
         * The previous green was not a scale: `50` was darker than `100`, and
         * `400` was a teal among grass tones. Lightness has to fall
         * monotonically or every surface built from it fights the next one.
         *
         * The 600 is deliberately deep. Green contributes more to perceived
         * luminance than any other hue, so a bright grass green cannot carry
         * white text — the brightest one that reaches WCAG AA against white is
         * only 4.39:1, i.e. a primary button whose own label is unreadable.
         * #158431 clears it at 4.80:1 and still reads unmistakably green.
         *
         * Verified: white on 600 = 4.80 · 600 on white = 4.80 ·
         * 400 on the dark panel = 9.15 · 300 on the dark panel = 10.86.
         *
         * Exported under BOTH names. `cobalt` is historical — ~250 usages
         * across the app still reference it — so it aliases the same ramp
         * rather than forcing a rename that would touch every file.
         */
        brand: BRAND,
        cobalt: BRAND,
        // Aurora — the accent used for status positives / glowing rings
        aurora: {
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
        },
        surface: {
          DEFAULT: 'rgb(var(--panel) / <alpha-value>)',
          strong: 'rgb(var(--panel) / <alpha-value>)',
          muted: 'rgb(var(--panel-2) / <alpha-value>)',
        },
        /**
         * Structure, visible.
         *
         * These were 6% and 12% white on a near-black ground — roughly 1.3:1
         * contrast, i.e. invisible. Panels did not read as panels, which is
         * the single biggest reason the interface felt unstructured.
         * Driven by CSS variables so light and dark each get a real value.
         */
        border: {
          DEFAULT: 'rgb(var(--line) / <alpha-value>)',
          strong: 'rgb(var(--line-strong) / <alpha-value>)',
        },
        /**
         * `white` is remapped to the ink token.
         *
         * It carries two jobs in this codebase: 130 `text-white` usages, and
         * ~150 `bg-white/[0.0x]` inset surfaces. Pointing it at --ink fixes
         * both at once — on a dark ground it stays near-white as before, and
         * on a light ground it becomes near-black text and a faint grey wash.
         *
         * The handful of places that need literal white on a coloured button
         * use `text-onbrand` instead.
         */
        white: 'rgb(var(--ink) / <alpha-value>)',
        onbrand: '#ffffff',

        /* Text hierarchy. `slate` is remapped because the app already uses it
           for 579 of its text colours — redefining it here makes every one of
           those theme-aware without editing a single component. */
        slate: {
          100: 'rgb(var(--ink) / <alpha-value>)',
          200: 'rgb(var(--ink) / <alpha-value>)',
          300: 'rgb(var(--ink-2) / <alpha-value>)',
          400: 'rgb(var(--ink-2) / <alpha-value>)',
          500: 'rgb(var(--ink-3) / <alpha-value>)',
          600: 'rgb(var(--ink-3) / <alpha-value>)',
          700: 'rgb(var(--ink-3) / <alpha-value>)',
          900: 'rgb(var(--ink) / <alpha-value>)',
        },
      },
      backgroundImage: {
        'aurora-radial':
          'radial-gradient(1200px 600px at 10% -10%, rgba(53, 197, 89, 0.35), transparent 60%), radial-gradient(900px 500px at 100% 0%, rgba(6,182,212,0.18), transparent 60%), radial-gradient(700px 500px at 50% 120%, rgba(31,71,240,0.18), transparent 60%)',
        'grid-fade':
          'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
      },
      backgroundSize: {
        grid: '48px 48px',
      },
      /**
       * Four type roles, not ten.
       *
       * The app previously used ten distinct sizes with 75% of all text at
       * 12-14px, so nothing was emphasised and the eye had nothing to anchor
       * to. `xs` and `sm` are REDEFINED rather than replaced: that lifts ~450
       * existing usages to a readable floor without touching a call site.
       *
       * 13px is the floor. A cashier reads this at arm's length under tube
       * lighting, not on a laptop.
       */
      /**
       * A real modular scale, ~1.22 between steps.
       *
       * The four content roles were already here; what was missing is that
       * `lg / xl / 2xl / 3xl` still carried Tailwind's defaults (18/20/24/30),
       * so headings sat OFF the scale and the jumps between them were uneven —
       * 15 to 18 is barely a step, 16 to 24 is a leap. Redefined here, every
       * existing heading lands on the ladder with no component edits.
       *
       * Large type also gets negative tracking. At 26px and up, default letter
       * spacing reads loose and amateur; the optical correction is what makes
       * a heading look typeset rather than merely enlarged.
       */
      fontSize: {
        xs: ['0.8125rem', { lineHeight: '1.15rem' }],                          // 13 — labels, captions
        sm: ['0.9375rem', { lineHeight: '1.4rem' }],                           // 15 — body
        base: ['1rem', { lineHeight: '1.5rem' }],                              // 16
        item: ['1.0625rem', { lineHeight: '1.35rem' }],                        // 17 — product names, amounts
        lg: ['1.1875rem', { lineHeight: '1.6rem', letterSpacing: '-0.006em' }],// 19 — card titles
        xl: ['1.4375rem', { lineHeight: '1.85rem', letterSpacing: '-0.012em' }],// 23 — section heads
        '2xl': ['1.75rem', { lineHeight: '2.15rem', letterSpacing: '-0.018em' }],// 28 — page titles
        '3xl': ['2.125rem', { lineHeight: '2.5rem', letterSpacing: '-0.022em' }],// 34
        total: ['2.125rem', { lineHeight: '2.3rem', letterSpacing: '-0.02em' }],// 34 — the one number that matters
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
          '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 8px 32px -8px rgba(20, 20, 20, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.04)',
        'glass-lg':
          '0 1px 0 0 rgba(255,255,255,0.08) inset, 0 24px 64px -16px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.05)',
        /* A focus/attention ring, not a neon halo. The old 40px glow made
           every primary button look like a toy; a control should sit ON the
           surface, not hover above it radiating light. */
        glow: '0 0 0 3px rgba(21, 132, 49, 0.18)',
      },
      /**
       * THREE radii, not five.
       *
       * The app was using 4, 6, 8, 12 and 16px on rectangular elements with no
       * rule governing which went where — a 12px card holding an 8px input
       * holding a 6px badge. The eye reads that as noise, and it is the real
       * source of the "sharp edges in the wrong places" feeling.
       *
       * These are REDEFINITIONS of Tailwind's own names, so all ~260 existing
       * `rounded-*` usages snap onto the scale without touching a component.
       * Radius now follows element size, the way concentric corners should:
       *
       *   6px   chips, badges, keycaps, tiny inline controls
       *   10px  inputs, buttons, selects, list rows  (md and lg collapse here)
       *   14px  cards, panels, dialogs              (xl and 2xl collapse here)
       */
      borderRadius: {
        sm: '0.375rem',      // 6px
        DEFAULT: '0.625rem', // 10px — was 4px, far too tight beside a 14px card
        md: '0.625rem',      // 10px — was 6px
        lg: '0.625rem',      // 10px — was 8px
        xl: '0.875rem',      // 14px
        '2xl': '0.875rem',   // 14px — collapsed into the card radius
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
