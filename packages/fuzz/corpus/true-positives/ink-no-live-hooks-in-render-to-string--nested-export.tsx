// rule: ink-no-live-hooks-in-render-to-string
// weakness: component-ownership
// source: Cursor Bugbot review on PR 1404
import { renderToString, useInput } from "ink";

export const makeSnapshot = () => {
  const SnapshotInput = () => {
    useInput(() => {});
    return null;
  };

  return renderToString(<SnapshotInput />);
};
