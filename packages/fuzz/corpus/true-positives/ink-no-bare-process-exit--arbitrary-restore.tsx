// rule: ink-no-bare-process-exit
// source: an arbitrary restore helper does not prove complete Ink terminal cleanup
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
