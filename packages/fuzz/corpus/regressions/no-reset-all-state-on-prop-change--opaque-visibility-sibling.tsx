// rule: no-reset-all-state-on-prop-change
// weakness: control-flow
// source: PR #1264 opaque visibility sibling regression
import { useEffect, useState } from "react";

interface OpaqueVisibilityPanelProps {
  isAllowed: () => boolean;
  visible: boolean;
}

export const OpaqueVisibilityPanel = ({ isAllowed, visible }: OpaqueVisibilityPanelProps) => {
  const [canShowPanel, setCanShowPanel] = useState(true);

  useEffect(() => {
    setCanShowPanel(true);
  }, [visible]);

  return (
    visible &&
    isAllowed() &&
    canShowPanel && <output onClick={() => setCanShowPanel(false)}>Panel</output>
  );
};
