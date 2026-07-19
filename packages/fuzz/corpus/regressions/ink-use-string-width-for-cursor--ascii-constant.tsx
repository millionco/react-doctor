// rule: ink-use-string-width-for-cursor
// weakness: copy-tracking
// source: adversarial audit of PR 1404 ASCII-only cursor labels
import { useCursor } from "ink";

export const App = () => {
  const label = "Ready";
  const cursor = useCursor();
  cursor.setCursorPosition({ x: label.length, y: 0 });
  return null;
};
