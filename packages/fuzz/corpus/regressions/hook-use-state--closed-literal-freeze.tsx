// rule: hook-use-state
// verdict: pass
// weakness: library-idiom
// source: synthetic closed literal freeze with an omitted setter
import { useState } from "react";

const frozenPalette = Object.freeze({
  label: "ready",
  items: Object.freeze([]),
  metadata: Object.freeze({ enabled: true }),
});

export const useFrozenPalette = () => {
  const [palette] = useState(frozenPalette);
  return palette;
};
