// verdict: pass
// rule: exhaustive-deps
// weakness: controlled-state-global-generic
// source: Bugbot PR #1579

import { useCallback, useState } from "react";

interface ArrayRangeSelectProps {
  onChange: (value: Array<string>) => void;
  value?: Array<string>;
}

export const ArrayRangeSelect = ({ onChange, value }: ArrayRangeSelectProps) => {
  const [internalSelectedOptions] = useState<Array<string>>([]);
  const isControlled = value !== undefined;
  const selectedOptions = (isControlled ? value : internalSelectedOptions) ?? [];
  return useCallback(() => onChange(selectedOptions), [onChange, selectedOptions]);
};

interface ReadonlyArrayRangeSelectProps {
  onChange: (value: ReadonlyArray<string>) => void;
  value?: ReadonlyArray<string>;
}

export const ReadonlyArrayRangeSelect = ({ onChange, value }: ReadonlyArrayRangeSelectProps) => {
  const [internalSelectedOptions] = useState<ReadonlyArray<string>>([]);
  const isControlled = value !== undefined;
  const selectedOptions = (isControlled ? value : internalSelectedOptions) ?? [];
  return useCallback(() => onChange(selectedOptions), [onChange, selectedOptions]);
};
