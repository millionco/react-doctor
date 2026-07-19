// rule: rn-no-metro-babel-preset
// weakness: framework-gating
// source: OSS eval — ChainReactApp2019 (RN 0.60), UI Kitten (RN 0.70), gorhom/react-native-bottom-sheet (explicit legacy preset)

export const preRenameReactNativeManifest = {
  dependencies: { "react-native": "0.60.3" },
  devDependencies: { "metro-react-native-babel-preset": "^0.55.0" },
};

export const explicitlyResolvableLegacyPresetManifest = {
  dependencies: { "react-native": "0.76.0" },
  devDependencies: { "metro-react-native-babel-preset": "^0.77.0" },
};

export const legacyBabelPresetConfig = {
  presets: ["module:metro-react-native-babel-preset"],
};
