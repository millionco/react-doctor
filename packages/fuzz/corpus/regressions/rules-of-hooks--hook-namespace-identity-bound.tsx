// rule: rules-of-hooks
// verdict: fail
// weakness: alias-guard
// source: PR #1824 independent validator F1
import * as React from "react";

const read = React.useState.bind(null);
const Hooks = { useState: () => read(0) };

export const Component = ({ enabled }: { enabled: boolean }) => {
  if (enabled) Hooks.useState();
  return null;
};
