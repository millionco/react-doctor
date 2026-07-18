// rule: no-adjust-state-on-prop-change
// weakness: contract-inversion
// source: published React Doctor rule contract

import { useEffect, useState } from "react";

export const SelectableList = ({ items }: { items: string[] }) => {
  const [selection, setSelection] = useState<string | null>(null);

  useEffect(() => {
    setSelection(null);
  }, [items]);

  return <div>{selection}</div>;
};
