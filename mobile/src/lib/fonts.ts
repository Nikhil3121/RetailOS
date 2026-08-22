/**
 * Font names — the single source of truth for what to pass into every
 * StyleSheet `fontFamily`. Using explicit families (not fontWeight numbers)
 * eliminates the Android bold-synthesis "ghosted text" artifact — the OS
 * only synthesises when it has to bridge missing weights, and Inter loaded
 * via @expo-google-fonts ships real 400/500/600/700 files.
 */

export const font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;
