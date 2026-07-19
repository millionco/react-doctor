// rule: ink-suspense-requires-concurrent
// weakness: control-flow
// source: adversarial audit of PR 1404 renderer graph reachability
import { Suspense } from "react";
import { render, Text } from "ink";

const App = () => (
  <>
    {false && (
      <Suspense fallback={null}>
        <Text>unused</Text>
      </Suspense>
    )}
  </>
);

render(<App />);
