// rule: rules-of-hooks
// verdict: fail
// weakness: alias-guard
// source: PR #1824 independent validator F1
import { useState } from "react";

const Hooks = { useState: (callback: typeof useState) => callback(0) };

export const Component = ({ enabled }: { enabled: boolean }) => {
  if (enabled) Hooks.useState(useState);
  return null;
};
