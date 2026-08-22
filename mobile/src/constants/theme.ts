/**
 * RetailOS design tokens.
 *
 * The primary family is INDIGO — chosen over the earlier cobalt because
 * indigo reads distinctly on both dark and light grounds without becoming
 * either "washed royal blue" (cobalt on dark) or "office blue" (cobalt on
 * light). Aurora cyan stays as the rare accent used for signal / pulse.
 *
 * Kept as a plain object so both StyleSheet.create() styles and NativeWind
 * class names can source the same values (the color literals also live in
 * tailwind.config.js under the same key names).
 */

import { font } from '@/lib/fonts';

export const colors = {
  // Ink — dark ground scale
  ink950: '#05070d',
  ink900: '#0a0d16',
  ink800: '#0f1220',
  ink700: '#151a2d',
  ink600: '#1c2340',

  // Primary — indigo / violet family
  primary50:  '#eef2ff',
  primary100: '#e0e7ff',
  primary200: '#c7d2fe',
  primary300: '#a5b4fc',
  primary400: '#818cf8',
  primary500: '#6366f1',   // primary
  primary600: '#4f46e5',
  primary700: '#4338ca',
  primary800: '#3730a3',
  primary900: '#312e81',
  primary950: '#1e1b4b',

  // Alias — kept for backwards compat with older code still saying "cobalt"
  cobalt50:  '#eef2ff',
  cobalt100: '#e0e7ff',
  cobalt200: '#c7d2fe',
  cobalt300: '#a5b4fc',
  cobalt400: '#818cf8',
  cobalt500: '#6366f1',
  cobalt600: '#4f46e5',
  cobalt700: '#4338ca',
  cobalt800: '#3730a3',
  cobalt900: '#312e81',
  cobalt950: '#1e1b4b',

  // Aurora — rare accent (signal, pulse, "live" dot). Not a UI colour.
  aurora400: '#22d3ee',
  aurora500: '#06b6d4',
  aurora600: '#0891b2',

  // Glass surfaces
  surface: 'rgba(15, 18, 32, 0.72)',
  surfaceStrong: 'rgba(10, 13, 22, 0.92)',
  surfaceMuted: 'rgba(21, 26, 45, 0.55)',
  surfaceElevated: 'rgba(28, 35, 64, 0.65)',

  // Borders
  border: 'rgba(255, 255, 255, 0.06)',
  borderStrong: 'rgba(255, 255, 255, 0.12)',

  // Text
  white: '#ffffff',
  slate50:  '#f8fafc',
  slate100: '#f1f5f9',
  slate200: '#e2e8f0',
  slate300: '#cbd5e1',
  slate400: '#94a3b8',
  slate500: '#64748b',
  slate600: '#475569',
  slate700: '#334155',

  // Status
  success300: '#6ee7b7',
  success500: '#10b981',
  success600: '#059669',
  warning200: '#fde68a',
  warning300: '#fcd34d',
  warning500: '#f59e0b',
  danger300: '#fda4af',
  danger400: '#fb7185',
  danger500: '#f43f5e',
  danger600: '#e11d48',

  // Legacy status aliases
  emerald300: '#6ee7b7',
  emerald400: '#34d399',
  emerald500: '#10b981',
  emerald600: '#059669',
  amber200: '#fde68a',
  amber300: '#fcd34d',
  amber500: '#f59e0b',
  rose300: '#fda4af',
  rose400: '#fb7185',
  rose500: '#f43f5e',
  rose600: '#e11d48',
} as const;

export const radius = {
  xs: 4,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  '2xl': 20,
  '3xl': 24,
  full: 9999,
} as const;

export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

/**
 * Type scale. Each returns a StyleSheet object callers spread into their own
 * styles: `...typo.h1`. Every entry uses a real Inter weight (never a
 * numeric fontWeight — that's what caused the ghosted text).
 */
export const typo = {
  display: { fontFamily: font.bold,     fontSize: 36, lineHeight: 40, letterSpacing: -0.8 },
  h1:      { fontFamily: font.semibold, fontSize: 26, lineHeight: 30, letterSpacing: -0.5 },
  h2:      { fontFamily: font.semibold, fontSize: 22, lineHeight: 26, letterSpacing: -0.4 },
  h3:      { fontFamily: font.semibold, fontSize: 18, lineHeight: 22, letterSpacing: -0.2 },
  body:    { fontFamily: font.regular,  fontSize: 14, lineHeight: 20 },
  bodyMd:  { fontFamily: font.medium,   fontSize: 14, lineHeight: 20 },
  small:   { fontFamily: font.regular,  fontSize: 12, lineHeight: 16 },
  smallMd: { fontFamily: font.medium,   fontSize: 12, lineHeight: 16 },
  caption: { fontFamily: font.regular,  fontSize: 11, lineHeight: 14 },
  label:   {
    fontFamily: font.semibold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },
  button:  { fontFamily: font.semibold, fontSize: 14, lineHeight: 18, letterSpacing: -0.2 },
} as const;

/**
 * Aurora radial gradients — matches desktop's `body` background-image.
 * Consumed by AppBackground.
 */
export const aurora = {
  a: { cx: '10%', cy: '-10%', rx: '90%', ry: '55%', color: 'rgb(99,102,241)',  opacity: 0.30 },
  b: { cx: '100%', cy: '0%',  rx: '75%', ry: '45%', color: 'rgb(6,182,212)',   opacity: 0.16 },
  c: { cx: '50%', cy: '120%', rx: '65%', ry: '50%', color: 'rgb(79,70,229)',   opacity: 0.16 },
} as const;

export const shadows = {
  glass: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 4,
  },
  glassStrong: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.55,
    shadowRadius: 32,
    elevation: 8,
  },
  glow: {
    shadowColor: colors.primary500,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 6,
  },
} as const;
