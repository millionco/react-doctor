// rule: no-boolean-toggle-without-functional-update
// weakness: framework-gating
// source: Cursor Bugbot review on PR #1383

import { useEffect, useState } from "react";

export const WorkerToggle = () => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    self.setTimeout(() => setOpen(!open), 100);
  }, []);
  return null;
};
