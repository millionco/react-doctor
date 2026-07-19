// rule: no-pass-data-to-parent
// weakness: external-state-origin
// source: adversarial review of external subscription hook provenance
import { useEffect } from "react";
import { useVisibility } from "../hooks/use-visibility";

export const VisibilityStatus = ({
  onVisibilityChange,
}: {
  onVisibilityChange: (isVisible: boolean) => void;
}) => {
  const isVisible = useVisibility();

  useEffect(() => {
    onVisibilityChange(isVisible);
  }, [isVisible, onVisibilityChange]);

  return null;
};
