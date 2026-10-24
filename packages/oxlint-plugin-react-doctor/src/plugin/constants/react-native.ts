export const RAW_TEXT_PREVIEW_MAX_CHARS = 30;

export const GORHOM_BOTTOM_SHEET_MODULE_NAME = "@gorhom/bottom-sheet";

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

// React Native host/layout primitives that mount children into a native view,
// so raw text directly inside one is a certain runtime crash ("Text strings
// must be rendered within a <Text>"). `rn-no-raw-text` anchors its report here.
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

// Transparent wrappers render no host view of their own, so their children
// render at the surrounding location; the rule steps through them when checking
// whether raw text sits inside a real <Text> (a bare <fbt> outside <Text> is
// still reported). Only config-INDEPENDENT wrappers belong here: compile-erased
// i18n markers (fbtee's <fbt> / <fbs>; their <fbt:*> children match by
// namespace, so the one "fbt" entry covers them) and React's structural
// <Fragment> / <React.Fragment>. <Trans> / <FormattedMessage> are excluded —
// whether they wrap children in a <Text> is a per-project provider choice, so
// they belong in an opt-in `transparentComponents` config instead.
// Ref: https://github.com/millionco/react-doctor/issues/581
export const REACT_NATIVE_TRANSLATION_TEXT_COMPONENTS = new Set(["fbt", "fbs"]);

export const REACT_NATIVE_TEXT_TRANSPARENT_COMPONENTS = new Set([
  "Fragment",
  ...REACT_NATIVE_TRANSLATION_TEXT_COMPONENTS,
]);

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
export const MAX_RENDERED_ROOT_SHAPE_ALTERNATIVE_COUNT = 64;

// Expo's Universal UI (`@expo/ui`) entry points. The universal package
// re-exports the platform-specific builds, so a component may be imported
// from the root or from either platform subpath.
// Ref: https://docs.expo.dev/versions/v56.0.0/sdk/ui/universal/
export const EXPO_UI_MODULE_SOURCES = new Set([
  "@expo/ui",
  "@expo/ui/swift-ui",
  "@expo/ui/jetpack-compose",
]);

// Modules whose FlatList/SectionList exports are the real react-native
// virtualized lists — gesture-handler re-exports them with gesture support.
// Mirrors rn-prefer-pressable's TOUCHABLE_SOURCES.
export const REACT_NATIVE_LIST_MODULE_SOURCES = new Set([
  "react-native",
  "react-native-gesture-handler",
]);

// Built-in RN virtualized lists. Unlike recyclers these have no owning package
// to resolve against, so rules match them by name and require the binding to
// resolve to a REACT_NATIVE_LIST_MODULE_SOURCES module (or an ambient/global
// reference).
export const REACT_NATIVE_BUILTIN_LIST_COMPONENTS = new Set([
  "FlatList",
  "SectionList",
  "VirtualizedList",
]);

// Recycling lists, keyed by their canonical exported name, mapped to the
// package(s) that actually own them. Rules resolve a local JSX name back to one
// of these via a real ES module import (handling renames), so a homegrown
// component named `FlashList` from a different package doesn't masquerade as the
// Shopify/Legend recycler.
export const RECYCLABLE_LIST_PACKAGES: Record<string, ReadonlyArray<string>> = {
  FlashList: ["@shopify/flash-list"],
  AnimatedFlashList: ["@shopify/flash-list"],
  LegendList: ["@legendapp/list", "@legendapp/list/react-native"],
  AnimatedLegendList: ["@legendapp/list/animated", "@legendapp/list/reanimated"],
  KeyboardAwareLegendList: ["@legendapp/list/keyboard"],
  KeyboardAvoidingLegendList: ["@legendapp/list/keyboard-legacy"],
};

export const SHOPIFY_FLASH_LIST_COMPONENTS = new Set(["FlashList", "AnimatedFlashList"]);

export const LEGEND_LIST_V3_PACKAGE_SOURCES = new Set([
  "@legendapp/list/react-native",
  "@legendapp/list/animated",
  "@legendapp/list/reanimated",
  "@legendapp/list/keyboard",
  "@legendapp/list/keyboard-legacy",
]);

// Flat list of every recycler-owning package source, for whole-file
// import-presence gates: a file importing none of these can never resolve a
// recycler, so per-element resolution is skipped entirely.
export const RECYCLABLE_LIST_PACKAGE_SOURCES: ReadonlyArray<string> =
  Object.values(RECYCLABLE_LIST_PACKAGES).flat();

// Every list-like element name: built-in RN lists plus the recycler exports.
// A name-only set for the cheap first filter — provenance lives in the rules.
export const REACT_NATIVE_LIST_COMPONENTS = new Set([
  ...REACT_NATIVE_BUILTIN_LIST_COMPONENTS,
  ...Object.keys(RECYCLABLE_LIST_PACKAGES),
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

export const REACT_NATIVE_MODULE_REMOVAL_MINOR: ReadonlyMap<string, number> = new Map([
  ["WebView", 60],
  ["AsyncStorage", 71],
]);

export const REACT_NATIVE_SINGLE_MINOR_RANGE_PATTERN =
  /^[~^=v]?\s*0\.\d+(?:\.(?:\d+|[xX*]))?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const NATIVE_LABEL_ATTRIBUTE_NAME = "accessibilityLabel";
export const NATIVE_LABEL_CANONICAL_MODULE_SOURCES: ReadonlySet<string> = new Set([
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-native",
]);
export const NATIVE_LABEL_CONTEXT_READ_APIS: ReadonlySet<string> = new Set(["use", "useContext"]);
export const NATIVE_LABEL_FORBIDDEN_PROP_NAMES: ReadonlySet<string> = new Set([
  NATIVE_LABEL_ATTRIBUTE_NAME,
  "aria-label",
  "aria-labelledby",
  "__proto__",
  "prototype",
  "constructor",
]);
export const NATIVE_LABEL_REFUSED_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "React",
  "ReactNative",
  "Function",
]);
export const NATIVE_LABEL_RESOLVER_NAMES: ReadonlySet<string> = new Set([
  "resolver",
  "resolveRequest",
  "extraNodeModules",
  "nodeModulesPaths",
  "alias",
]);
export const NATIVE_LABEL_CONFIG_FILE_PATTERN =
  /(?:^|\/)(?:metro|babel|vite|webpack)\.config\.[cm]?[jt]s$/;
export const NATIVE_LABEL_EXPO_TSCONFIG_SOURCE = "expo/tsconfig.base";
export const NATIVE_LABEL_TSCONFIG_FILE_NAMES = ["tsconfig.json", "jsconfig.json"];
export { MEMO_TUPLE_LOADER_SOURCES as NATIVE_LABEL_REFUSED_MODULE_SOURCES } from "./react.js";

export const NATIVE_LABEL_SINGLE_VALUE_COUNT = 1;
export const NATIVE_LABEL_CONTEXT_SHORTHAND_MINIMUM_MAJOR_VERSION = 19;

export const NATIVE_LABEL_NODE_LOADER_MEMBER_NAMES: ReadonlySet<string> = new Set([
  "getBuiltinModule",
  "mainModule",
  "binding",
  "_linkedBinding",
  "dlopen",
]);
export const NATIVE_LABEL_RUNTIME_CAPABILITY_NAMES: ReadonlySet<string> = new Set([
  ...NATIVE_LABEL_REFUSED_GLOBAL_NAMES,
  "require",
  "module",
  "process",
]);

export const NATIVE_LABEL_BABEL_CONFIG_NAMES = [
  ".babelrc",
  ".babelrc.json",
  ".babelrc.js",
  ".babelrc.cjs",
  "babel.config.js",
  "babel.config.cjs",
  "babel.config.mjs",
  "babel.config.ts",
];
export const NATIVE_LABEL_METRO_CONFIG_PATTERN = /(?:^|\/)metro\.config\.[cm]?[jt]s$/;
export const NATIVE_LABEL_METRO_MODULE_SOURCES: ReadonlySet<string> = new Set([
  "path",
  "node:path",
  "expo/metro-config",
  "uniwind/metro",
  "@storybook/react-native/metro/withStorybook",
]);

export const NATIVE_LABEL_PLATFORM_SUFFIX_PATTERN = /^\.(?:native|ios|android|web)\.[cm]?[jt]sx?$/;
