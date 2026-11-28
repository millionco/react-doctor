// Rule: no-derived-state
// Weakness: direct numeric accumulation was treated as a copy from props.
// Source: Authored regression for an effect consuming its previous state.
import { useEffect, useState } from "react";

export function MileageLog({ bonus }) {
  const [distance, setDistance] = useState(0);

  useEffect(() => {
    const adjustment = bonus ? 12 : 4;
    const accumulated = distance + adjustment;
    setDistance(accumulated);
  }, [bonus]);

  return <output>{distance}</output>;
}
