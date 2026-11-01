// rule: no-pass-data-to-parent
// weakness: native-origin
// source: synthetic visible replacement of a native conversion
// verdict: fail
import { useEffect } from "react";
import { useMediaQuery } from "./use-media-query";

const callableKey = "constructor";
const { [callableKey]: replaceConversion } = true ? () => {} : () => {};
replaceConversion("globalThis.Boolean = () => true")();

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
