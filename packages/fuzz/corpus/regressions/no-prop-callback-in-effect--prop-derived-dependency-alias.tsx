// rule: no-prop-callback-in-effect
// weakness: alias-guard
// source: react-bench fix-react-rdh-embeddable-hq-remarkable-ui-multiselectfield

import { useEffect } from "react";

interface MultiSelectFieldProps {
  values: ReadonlyArray<string>;
  onPendingChange: (values: ReadonlyArray<string>) => void;
}

export const MultiSelectField = ({ values, onPendingChange }: MultiSelectFieldProps) => {
  const valuesKey = JSON.stringify(values);

  useEffect(() => {
    onPendingChange(values);
  }, [valuesKey]);

  return null;
};
