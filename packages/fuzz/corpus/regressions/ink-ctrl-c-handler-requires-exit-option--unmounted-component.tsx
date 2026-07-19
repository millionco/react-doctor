// rule: ink-ctrl-c-handler-requires-exit-option
// weakness: component-ownership
// source: Cursor Bugbot review on PR 1404
import { render, useInput } from "ink";

const Root = () => null;

export const Unmounted = () => {
  useInput((input, key) => {
    if (key.ctrl && input === "c") copySelection();
  });
  return null;
};

render(<Root />);
