// rule: no-prop-types
// weakness: name-heuristic
// source: adversarial review of component receiver provenance

import { useMemo } from "react";

export const Schema = (items: string[]) => {
  const count = useMemo(() => items.length, [items]);
  return { count };
};

Schema.propTypes = { value: () => true };
