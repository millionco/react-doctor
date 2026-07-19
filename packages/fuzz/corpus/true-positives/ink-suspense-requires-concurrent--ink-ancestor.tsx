// rule: ink-suspense-requires-concurrent
// weakness: component-ownership
// source: Cursor Bugbot review on PR 1404
import { Suspense } from "react";
import { Box, render } from "ink";

const LazyScreen = () => null;

render(
  <Box>
    <Suspense fallback={null}>
      <LazyScreen />
    </Suspense>
  </Box>,
);
