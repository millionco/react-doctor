// rule: no-side-effect-in-state-updater-function
// weakness: library-idiom
// source: PR #1000 final independent audit

import { useState } from "react";

export const CustomMap = ({ onVisit }: { onVisit: () => void }) => {
  const [, setQueue] = useState({ map: (_callback: () => void) => null });
  setQueue((queue) => queue.map(onVisit));
  return null;
};
