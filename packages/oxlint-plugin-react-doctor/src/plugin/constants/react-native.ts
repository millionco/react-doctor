export const RAW_TEXT_PREVIEW_MAX_CHARS = 30;

export const REACT_NATIVE_TEXT_COMPONENTS = new Set([
  "Text",
  "TextInput",
  "Typography",
  "Paragraph",
  "Span",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
]);

export const REACT_NATIVE_TEXT_COMPONENT_KEYWORDS = new Set([
  "Text",
  "Title",
  "Label",
  "Heading",
  "Caption",
  "Subtitle",
  "Typography",
  "Paragraph",
  "Description",
  "Body",
]);

// Compile-time translation wrappers — fbtee's <fbt> / <fbs> and their
// namespaced children (<fbt:param>, <fbt:plural>, <fbt:name>, …) — are NOT
// React Native layout components. A Babel/SWC transform erases them at build
// time, so their text really renders inside the surrounding <Text>. The
// rn-no-raw-text rule treats them as *transparent*: raw text inside them is
// safe only when an enclosing element is a real text component (so a bare
// <fbt> outside <Text> is still reported).
//
// To extend the same behavior to another compile-time / i18n wrapper, add its
// tag name here — namespaced children are matched by their namespace, so a
// single entry (e.g. "fbt") covers every "<fbt:*>" child.
//
// Ref: https://github.com/millionco/react-doctor/issues/581
//      https://facebook.github.io/fbt/docs/api_intro
export const REACT_NATIVE_TEXT_TRANSPARENT_COMPONENTS = new Set(["fbt", "fbs"]);

// HACK: Maps (not plain objects) so that an unusual `import { constructor }
// from "react-native"` (or any other Object.prototype name) doesn't fall
// through to `Object.prototype.constructor` and falsely report. Symmetric
// with the deprecated-React-API rules in `architecture.ts`.
export const DEPRECATED_RN_MODULE_REPLACEMENTS = new Map<string, string>([
  ["AsyncStorage", "@react-native-async-storage/async-storage"],
  ["Picker", "@react-native-picker/picker"],
  ["PickerIOS", "@react-native-picker/picker"],
  ["DatePickerIOS", "@react-native-community/datetimepicker"],
  ["DatePickerAndroid", "@react-native-community/datetimepicker"],
  ["ProgressBarAndroid", "a community alternative"],
  ["ProgressViewIOS", "a community alternative"],
  ["SafeAreaView", "react-native-safe-area-context"],
  ["Slider", "@react-native-community/slider"],
  ["ViewPagerAndroid", "react-native-pager-view"],
  ["WebView", "react-native-webview"],
  ["NetInfo", "@react-native-community/netinfo"],
  ["CameraRoll", "@react-native-camera-roll/camera-roll"],
  ["Clipboard", "@react-native-clipboard/clipboard"],
  ["ImageEditor", "@react-native-community/image-editor"],
  ["MaskedViewIOS", "@react-native-masked-view/masked-view"],
]);

export const LEGACY_EXPO_PACKAGE_REPLACEMENTS = new Map<string, string>([
  ["expo-av", "expo-audio for audio and expo-video for video"],
  [
    "expo-permissions",
    "the permissions API in each module (e.g. Camera.requestPermissionsAsync())",
  ],
  ["expo-app-loading", "expo-splash-screen"],
  [
    "expo-linear-gradient",
    "the `backgroundImage` CSS gradient style prop (New Architecture) or expo-linear-gradient's successor",
  ],
  ["react-native-fast-image", "expo-image (drop-in with caching, placeholders, and crossfades)"],
]);

// Expo's Universal UI (`@expo/ui`) entry points. The universal package
// re-exports the platform-specific builds, so a component may be imported
// from the root or from either platform subpath.
// Ref: https://docs.expo.dev/versions/v56.0.0/sdk/ui/universal/
export const EXPO_UI_MODULE_SOURCES = new Set([
  "@expo/ui",
  "@expo/ui/swift-ui",
  "@expo/ui/jetpack-compose",
]);

export const REACT_NATIVE_LIST_COMPONENTS = new Set([
  "FlatList",
  "SectionList",
  "VirtualizedList",
  "FlashList",
  "LegendList",
]);

export const RENDER_ITEM_PROP_NAMES = new Set([
  "renderItem",
  "renderSectionHeader",
  "renderSectionFooter",
]);

export const LEGACY_SHADOW_STYLE_PROPERTIES = new Set([
  "shadowColor",
  "shadowOffset",
  "shadowOpacity",
  "shadowRadius",
  "elevation",
]);
