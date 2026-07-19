// rule: ink-suspense-requires-concurrent
// weakness: component-ownership
// source: adversarial audit of PR 1404 same-file renderer graph
import { Suspense } from "react";
import { render, Text } from "ink";

const Root = () => {
  const _Unused = () => (
    <Suspense fallback={null}>
      <Text>unused</Text>
    </Suspense>
  );
  return <Text>root</Text>;
};

render(<Root />);
