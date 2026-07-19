// rule: ink-no-multiple-static
// weakness: control-flow
// source: adversarial audit of PR 1404 against Ink Static ownership
import { Static } from "ink";

export const App = ({ compact }: { compact: boolean }) => (
  <>
    {compact && <Static items={[]} />}
    {!compact && <Static items={[]} />}
  </>
);
