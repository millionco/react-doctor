const SCROLLVIEW_NAMES = new Set([
  "ScrollView",
  "FlatList",
  "SectionList",
  "VirtualizedList",
  "KeyboardAwareScrollView",
]);

const RECYCLER_SCROLL_CONTENT_NAMES = new Set(["FlashList", "LegendList"]);

export const isContentContainerStyleScrollContainer = (elementName: string): boolean =>
  SCROLLVIEW_NAMES.has(elementName) || RECYCLER_SCROLL_CONTENT_NAMES.has(elementName);
