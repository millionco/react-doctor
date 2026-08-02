// rule: no-pass-data-to-parent
// weakness: typescript-type-position
// source: ReactBench Remarkable UI MultiSelectField

import { useEffect } from "react";

interface SelectOptionValue {
  value: string;
}

interface MultiSelectFieldProperties<Value extends SelectOptionValue> {
  onPendingChange?: (values: Value[]) => void;
  values?: Value[];
}

const EMPTY_VALUES: SelectOptionValue[] = [];

export const MultiSelectField = <Value extends SelectOptionValue>({
  onPendingChange,
  values: valuesProperty,
}: MultiSelectFieldProperties<Value>) => {
  const values = (valuesProperty ?? (EMPTY_VALUES as Value[])) as Value[];

  useEffect(() => {
    onPendingChange?.(values);
  }, [onPendingChange, values]);

  return null;
};
