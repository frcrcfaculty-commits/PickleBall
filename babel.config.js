module.exports = {
  presets: ['@react-native/babel-preset'],
  plugins: [
    // Required for VisionCamera Frame Processors
    ['react-native-worklets-core/plugin'],
    // Required for gesture/animation support
    ['react-native-reanimated/plugin'],
  ],
};
