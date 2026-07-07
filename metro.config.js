const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

const config = {
  resolver: {
    // Allow bundling of TFLite model files and audio assets
    assetExts: [
      ...defaultConfig.resolver.assetExts,
      'tflite',
      'wav',
      'mp3',
    ],
  },
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true, // Improves startup time
      },
    }),
  },
};

module.exports = mergeConfig(defaultConfig, config);
