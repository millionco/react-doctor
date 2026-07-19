// rule: ink-ctrl-c-handler-requires-exit-option
// weakness: control-flow
// source: Cursor Bugbot review on PR 1404
import { render, useInput } from "ink";

const App = () => {
  useInput((input, key) => {
    if (key.ctrl) toggleMode();
    if (input === "c") copySelection();
  });
  return null;
};

render(<App />);
