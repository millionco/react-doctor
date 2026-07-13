// rule: no-prop-types
// weakness: ambiguous-control-flow-provenance
// source: adversarial review of component receiver provenance

import { useMemo } from "react";

export const Outer = ({ useValidationObject }: { useValidationObject: boolean }) => {
  const Panel = useMemo(() => {
    if (useValidationObject) return { value: true };
    return () => <div />;
  }, [useValidationObject]);
  (Panel as { propTypes: Record<string, () => boolean> }).propTypes = { value: () => true };
  return null;
};
