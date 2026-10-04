// verdict: pass
// rule: rn-scrollview-dynamic-padding
// weakness: static-value-guard
// source: GitHub issue #1785
import type { ReactElement } from "react";
import { FlashList } from "@shopify/flash-list";
import { Text } from "react-native";

const rows = [{ id: "one" }];
function renderRow({ item }: { item: { id: string } }) {
  return <Text>{item.id}</Text>;
}

function Grid({ ListHeaderComponent }: { ListHeaderComponent?: ReactElement }) {
  return (
    <FlashList
      data={rows}
      keyExtractor={(item) => item.id}
      renderItem={renderRow}
      ListHeaderComponent={ListHeaderComponent}
      contentContainerStyle={{ paddingTop: ListHeaderComponent ? 0 : 16 }}
    />
  );
}

export function Screen({ selectedTab }: { selectedTab: "profile" | "badges" }) {
  return <Grid ListHeaderComponent={<Text>{selectedTab}</Text>} />;
}
