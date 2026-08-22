/**
 * Babel config — extends Expo defaults with the NativeWind preset so
 * className props get compiled into StyleSheet objects at build time.
 * Without this, `<View className="bg-ink-900" />` silently renders unstyled.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
  };
};
