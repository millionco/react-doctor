// rule: ink-suspense-requires-concurrent
// weakness: component-ownership
// source: Cursor Bugbot review on PR 1404
import { Suspense } from "react";
import { render, Text } from "ink";

const Root = () => <Text>root</Text>;

export const Unmounted = () => (
  <Suspense fallback={null}>
    <Text>unused</Text>
  </Suspense>
);

render(<Root />);
