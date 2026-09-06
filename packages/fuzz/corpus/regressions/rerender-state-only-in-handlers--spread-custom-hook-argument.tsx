// rule: rerender-state-only-in-handlers
// weakness: copy-tracking
// source: Fresh handwritten spread hook argument regression
// verdict: pass

import { useState } from "react";

declare const styles: { useVariants: (...values: unknown[]) => void };

export const Preview = () => {
  const [value, setValue] = useState(0);
  styles.useVariants(...[{ value }]);
  return <button onClick={() => setValue(value + 1)}>Change</button>;
};
