// rule: only-export-components
// weakness: library-idiom
// source: fuzz FP hunt 2026-07-09 (twenty front-components: `export default
//         defineFrontComponent({ … })` is an SDK definition fed only a config
//         object — not an unnamed component)
import { useState } from "react";

declare const defineFrontComponent: (definition: {
  name: string;
  component: () => unknown;
}) => unknown;

const ContributorStats = () => {
  const [count] = useState(0);
  return <div>{count}</div>;
};

export default defineFrontComponent({
  name: "Contributor Stats",
  component: ContributorStats,
});
