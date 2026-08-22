/** Ambient type declarations. */

/**
 * Allow side-effect imports of NativeWind's global stylesheet.
 * Metro's NativeWind transformer turns this into a StyleSheet at build
 * time; TS just needs to know the import is valid.
 */
declare module '*.css';
