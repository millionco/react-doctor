// rule: no-pass-data-to-parent
// weakness: wrapper-transparency
// source: synthetic native conversion of parent and external inputs
// verdict: pass
import { useEffect } from "react";
import { useMediaQuery } from "./use-media-query";

interface PanelProps {
  enabled: boolean;
  onChange: (active: boolean) => void;
}

export const Panel = ({ enabled, onChange }: PanelProps) => {
  const mediaMatches = useMediaQuery("(max-width: 600px)");
  const active = Boolean(enabled) && mediaMatches;
  useEffect(() => {
    onChange(active);
  }, [active, onChange]);
  return null;
};
