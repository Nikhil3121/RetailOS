/**
 * Metro bundler config — wraps Expo's default config with NativeWind's
 * transformer so `global.css` compiles into a StyleSheet consumed by RN.
 */
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: './global.css' });
