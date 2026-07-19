// rule: ink-no-bare-process-exit
// weakness: cleanup-provenance
// source: Ink exit does not make a later process.exit safe
import { useApp, useInput } from "ink";

export const App = () => {
  const { exit } = useApp();
  useInput(() => {
    exit();
    process.exit(0);
  });
  return null;
};
