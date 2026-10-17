// rule: no-pass-data-to-parent
// verdict: fail
// weakness: alias-guard
// source: synthetic namespace provider binding
namespace globalThis {
  export namespace Shape {
    export interface Marker {}
  }
}
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
