// rule: ink-no-bare-process-exit
// weakness: explicit-cleanup
// source: explicit terminal restoration permits a deliberate process exit
import { useInput } from "ink";

interface AppProperties {
  restore: () => void;
}

export const App = ({ restore }: AppProperties) => {
  useInput(() => {
    restore();
    process.exit(0);
  });
  return null;
};
