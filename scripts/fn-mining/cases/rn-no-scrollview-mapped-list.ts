import type { FnMiningCase } from "../fn-mining-case.js";

// Doc pattern: `<ScrollView>{items.map(...)}</ScrollView>` mounts every
// row. Variants probe child nesting (the rule only inspects direct
// expression-container children) and iteration shapes.
export const rnNoScrollviewMappedListCases: FnMiningCase[] = [
  {
    ruleId: "rn-no-scrollview-mapped-list",
    description: "canonical: items.map directly inside ScrollView",
    filePath: "src/feed.tsx",
    code: `
      import { ScrollView } from "react-native";
      const Feed = ({ items }: { items: Post[] }) => (
        <ScrollView>{items.map((item) => <Row key={item.id} data={item} />)}</ScrollView>
      );
    `,
    shouldFire: true,
  },
  {
    ruleId: "rn-no-scrollview-mapped-list",
    description: "map wrapped in an intermediate <View> child",
    filePath: "src/feed.tsx",
    code: `
      import { ScrollView, View } from "react-native";
      const Feed = ({ items }: { items: Post[] }) => (
        <ScrollView>
          <View>{items.map((item) => <Row key={item.id} data={item} />)}</View>
        </ScrollView>
      );
    `,
    shouldFire: false,
    carveOutReason:
      "The rule only inspects direct ScrollView expression-container children — a mapped list nested inside an intermediate wrapper is outside the direct-child probe.",
  },
  {
    ruleId: "rn-no-scrollview-mapped-list",
    description: "filter().map() chain directly inside ScrollView",
    filePath: "src/feed.tsx",
    code: `
      import { ScrollView } from "react-native";
      const Feed = ({ items }: { items: Post[] }) => (
        <ScrollView>{items.filter((item) => item.visible).map((item) => <Row key={item.id} data={item} />)}</ScrollView>
      );
    `,
    shouldFire: true,
  },
  {
    ruleId: "rn-no-scrollview-mapped-list",
    description: "map inside a fragment child of ScrollView",
    filePath: "src/feed.tsx",
    code: `
      import { ScrollView } from "react-native";
      const Feed = ({ items }: { items: Post[] }) => (
        <ScrollView>
          <>{items.map((item) => <Row key={item.id} data={item} />)}</>
        </ScrollView>
      );
    `,
    shouldFire: false,
    carveOutReason:
      "Same direct-child gate as the intermediate View wrapper — fragment children are not direct expression-container children of ScrollView.",
  },
  {
    ruleId: "rn-no-scrollview-mapped-list",
    description: "rows built with reduce instead of map",
    filePath: "src/feed.tsx",
    code: `
      import { ScrollView } from "react-native";
      const Feed = ({ items }: { items: Post[] }) => (
        <ScrollView>
          {items.reduce<JSX.Element[]>((accumulated, item) => [...accumulated, <Row key={item.id} data={item} />], [])}
        </ScrollView>
      );
    `,
    shouldFire: true,
  },
  {
    ruleId: "rn-no-scrollview-mapped-list",
    description: "Animated.ScrollView member element with a mapped list",
    filePath: "src/feed.tsx",
    code: `
      import { Animated } from "react-native";
      const Feed = ({ items }: { items: Post[] }) => (
        <Animated.ScrollView>{items.map((item) => <Row key={item.id} data={item} />)}</Animated.ScrollView>
      );
    `,
    shouldFire: true,
  },
];
