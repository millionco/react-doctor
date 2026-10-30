// rule: no-pass-data-to-parent
// weakness: alias-guard
// source: independently-authored-public-synthetic
// verdict: fail

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
import { mutate } from "./external";
function expose() {
  interface Boolean {}
  mutate(Boolean);
}
expose();
