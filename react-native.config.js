// react-native.config.js
// Links native modules and configures C++ TurboModule compilation

module.exports = {
  project: {
    ios: {
      sourceDir: './ios',
    },
    android: {
      sourceDir: './android',
    },
  },
  dependencies: {
    // Auto-linking handles most deps; manual overrides below if needed
  },
  // C++ TurboModule configuration for the New Architecture
  cxxModules: {
    picklejudge_cv: {
      root: './cpp',
      cmakeListsPath: './CMakeLists.txt',
    },
  },
};
