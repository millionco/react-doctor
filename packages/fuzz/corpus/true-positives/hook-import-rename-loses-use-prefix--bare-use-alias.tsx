// rule: hook-import-rename-loses-use-prefix
// weakness: name-heuristic
// source: deep review of PR #1359

import { useState as use } from "react";

export const Counter = ({ enabled }: { enabled: boolean }) => {
  if (enabled) use(0);
  return null;
};
