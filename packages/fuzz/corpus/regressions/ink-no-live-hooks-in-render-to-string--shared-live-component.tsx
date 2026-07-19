// rule: ink-no-live-hooks-in-render-to-string
// weakness: component-ownership
// source: Ink renderToString docs support no-op terminal hooks and shared components
import { render, renderToString, useInput, useStdout } from "ink";

const App = () => {
  useInput(() => {});
  return null;
};

render(<App />);
renderToString(<App />);

export const SharedApp = () => {
  useInput(() => {});
  useStdout();
  return null;
};

renderToString(<SharedApp />);
