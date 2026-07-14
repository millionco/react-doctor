// rule: no-reset-all-state-on-prop-change
// weakness: control-flow
// source: React Bench Cloudscape hidden disabled-tooltip reset
import { useEffect, useState } from "react";

interface SelectItemProps {
  highlighted?: boolean;
}

export const SelectItem = ({ highlighted }: SelectItemProps) => {
  const [canShowTooltip, setCanShowTooltip] = useState(true);

  useEffect(() => {
    setCanShowTooltip(true);
  }, [highlighted]);

  return (
    highlighted &&
    canShowTooltip && <output onKeyDown={() => setCanShowTooltip(false)}>Disabled reason</output>
  );
};
