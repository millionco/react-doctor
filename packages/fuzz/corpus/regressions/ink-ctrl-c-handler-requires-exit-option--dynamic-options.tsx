// rule: ink-ctrl-c-handler-requires-exit-option
// weakness: dynamic-computed
// source: adversarial audit of PR 1404 renderer option resolution
import { render, useInput } from "ink";

const App = () => {
  useInput((input, key) => {
    if (key.ctrl && input === "c") save();
  });
  return null;
};

const options = { exitOnCtrlC: false };
render(<App />, { ...options });
