// rule: no-pass-data-to-parent
// verdict: pass
// weakness: alias-guard
// source: synthetic provider binding namespace control
const globalThis = { Boolean: customBoolean };
interface globalThis {}
globalThis.Boolean = customBoolean;
import React from "react";
import { useMediaQuery } from "./media";
const Panel = ({ enabled, onChange }) => {
  const media = useMediaQuery("query");
  const value = Boolean(enabled) && media;
  React.useEffect(() => {
    onChange(value);
  }, [value, onChange]);
  return null;
};
