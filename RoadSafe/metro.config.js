const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

const defaultConfig = getDefaultConfig(__dirname);

// Allow .tflite and other AI model files to be bundled
defaultConfig.resolver.assetExts.push('tflite', 'bin', 'pb', 'onnx');

const config = {
  transformer: {
    // Make sure Metro doesn’t try to parse binary files
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
  resolver: defaultConfig.resolver,
};

module.exports = mergeConfig(defaultConfig, config);
