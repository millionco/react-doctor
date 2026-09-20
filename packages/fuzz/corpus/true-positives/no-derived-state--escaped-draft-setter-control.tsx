// rule: no-derived-state
// verdict: fail
// weakness: alias-guard
// source: adversarial control for escaped-draft-setter
import { useEffect, useState } from "react";

export const useCopiedSelection = (selectedValue: string) => {
  const [value, setValue] = useState(selectedValue);
  useEffect(() => {
    setValue(selectedValue);
  }, [selectedValue]);
  return { value, setValue: value };
};
