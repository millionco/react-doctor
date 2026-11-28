// rule: effect-needs-cleanup
// verdict: safe
// weakness: name-heuristic
// source: synthetic coordinate arithmetic regression

import { useCallback } from "react";

type Vector = { horizontal: number; vertical: number };

const VectorMath = {
  sub(point: Vector, origin: Vector) {
    return {
      horizontal: point.horizontal - origin.horizontal,
      vertical: point.vertical - origin.vertical,
    };
  },
};

export function useTranslation() {
  const translate = useCallback((point: Vector, origin: Vector) => {
    const translation = VectorMath.sub(point, origin);
    return translation.horizontal + translation.vertical;
  }, []);
  return { translate };
}
