// rule: rules-of-hooks
// verdict: pass
// weakness: framework-gating
// source: synthetic Next Pages Router default export
// file-path: corpus/fixtures/next-pages/pages/index.tsx
import { useState } from "react";

const home = () => {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
};

export default home;
