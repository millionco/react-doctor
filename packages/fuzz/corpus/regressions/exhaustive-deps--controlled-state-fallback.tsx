// verdict: pass
// rule: exhaustive-deps
// weakness: unreachable-fresh-fallback
// source: React Bench RangeSelect

import { useMemo, useState } from "react";

interface RangeSelectProps {
  defaultValue?: string[];
  placeholder: string;
  value?: string[];
}

export const RangeSelect = ({ defaultValue, placeholder, value }: RangeSelectProps) => {
  const [internalSelectedOptions] = useState(defaultValue ?? []);
  const isControlled = value !== undefined;
  const selectedOptions = (isControlled ? value : internalSelectedOptions) ?? [];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => selectedOptions.join(", ") || placeholder, [selectedOptions, placeholder]);
};
