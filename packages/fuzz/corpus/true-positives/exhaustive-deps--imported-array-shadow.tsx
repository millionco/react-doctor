// verdict: fail
// rule: exhaustive-deps
// weakness: imported-global-type-shadow
// source: Bugbot PR #1579

import { useCallback, useState } from "react";
import type { Selection as Array } from "./selection";

interface RangeSelectProps {
  onChange: (value: Array<string>) => void;
  value?: Array<string>;
}

export const RangeSelect = ({ onChange, value }: RangeSelectProps) => {
  const [internalSelectedOptions] = useState<string[]>([]);
  const isControlled = value !== undefined;
  const selectedOptions = (isControlled ? value : internalSelectedOptions) ?? [];
  return useCallback(() => onChange(selectedOptions), [onChange, selectedOptions]);
};
