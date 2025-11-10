const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const defaultConfig = getDefaultConfig(__dirname);

// Extend supported asset extensions
defaultConfig.resolver.assetExts.push('tflite', 'txt');

const config = {
  resolver: {
    assetExts: defaultConfig.resolver.assetExts,
  },
};

module.exports = mergeConfig(defaultConfig, config);
