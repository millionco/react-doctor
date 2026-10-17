// rule: hook-use-state
// verdict: fail
// weakness: library-idiom
// source: synthetic actual setter naming next to closed literal freeze
import { useState } from "react";

const frozenPalette = Object.freeze({ label: "ready" });

export const useEditablePalette = () => {
  const [palette, replacePalette] = useState(frozenPalette);
  return { palette, replacePalette };
};
