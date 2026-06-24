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

// React Native host/layout primitives that mount their children into a native
// view, so rendering a raw string directly inside one throws the runtime
// "Text strings must be rendered within a <Text> component" crash. Raw text is
// a certain crash here without seeing any implementation, so `rn-no-raw-text`
// anchors its report on this set (see `isRawTextReportTarget`).
export const REACT_NATIVE_RAW_TEXT_HOST_COMPONENTS = new Set([
  "View",
  "ScrollView",
  "SafeAreaView",
  "KeyboardAvoidingView",
  "ImageBackground",
  "Modal",
  "Pressable",
  "TouchableOpacity",
  "TouchableHighlight",
  "TouchableWithoutFeedback",
  "TouchableNativeFeedback",
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

// Transparent wrappers — components that render NO React Native host view of
// their own, so their children render at the surrounding location. The
// rn-no-raw-text rule steps through them when deciding whether raw text sits
// inside a real <Text>: raw text inside a transparent wrapper is safe only when
// an enclosing element is a text component (so a bare <fbt> outside <Text> is
// still reported). Two config-INDEPENDENT flavors qualify for this always-on
// set — anything whose transparency depends on project setup must not be here:
//
//   - Compile-erased i18n markers — fbtee's <fbt> / <fbs> and their namespaced
//     children (<fbt:param>, <fbt:plural>, <fbt:enum>, <fbt:pronoun>,
//     <fbt:list>, <fbt:name>). A Babel/SWC transform erases them at build time.
//     Namespaced children are matched by their namespace, so the single "fbt"
//     entry covers every "<fbt:*>" child. The maintained fork (@nkzw/fbtee)
//     uses the same tags.
//   - React's structural <Fragment> / <React.Fragment> — renders nothing in any
//     build, so a <Fragment> between a <Text> and its text (or an <fbt>) must
//     not break the "inside a Text" check. (The "<>" shorthand is a JSXFragment
//     node the rule doesn't visit, so it isn't covered by this name.)
//
// Deliberately NOT here: the i18n <Trans> (react-i18next, @lingui/react) and
// <FormattedMessage> (react-intl). Whether they render transparently or wrap
// their children in a <Text> is a per-project PROVIDER choice the rule can't
// see — Lingui's `defaultComponent={Text}` and react-intl's
// `textComponent={Text}` are the recommended React Native setups — so
// hardcoding them as transparent would false-positive on the common
// "globally wrapped in <Text>" projects. They belong in an opt-in
// `transparentComponents` config whitelist instead.
//
// Ref: https://github.com/millionco/react-doctor/issues/581
//      https://facebook.github.io/fbt/docs/api_intro
//      https://react.i18next.com/latest/trans-component
//      https://lingui.dev/tutorials/react-native
//      https://formatjs.github.io/docs/react-intl/components/
export const REACT_NATIVE_TEXT_TRANSPARENT_COMPONENTS = new Set(["Fragment", "fbt", "fbs"]);

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
  ["react-native-fast-image", "expo-image (drop-in with caching, placeholders, and crossfades)"],
]);

export const FLASH_LIST_V2_MAJOR = 2;

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
