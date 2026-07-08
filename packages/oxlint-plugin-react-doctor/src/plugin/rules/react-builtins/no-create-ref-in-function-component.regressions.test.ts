import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCreateRefInFunctionComponent } from "./no-create-ref-in-function-component.js";

describe("react-builtins/no-create-ref-in-function-component — regressions", () => {
  // FN hunt (internxt useDriveItemActions): a useMemo-wrapped createRef runs
  // during the hook's render — the memo callback is transparent, and useRef
  // is still the right API.
  it("flags useMemo(() => createRef(), []) inside a custom hook", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef, useMemo } from 'react';
const useDriveItemActions = (item) => {
  const nameInputRef = useMemo(() => createRef(), []);
  return { nameInputRef };
};
export default useDriveItemActions;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("flags useMemo(() => createRef(), []) inside a component", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import React, { createRef, useMemo } from 'react';
function Editor() {
  const inputRef = React.useMemo(() => createRef(), []);
  return <input ref={inputRef} />;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("stays silent for a useMemo createRef outside any component or hook", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef, useMemo } from 'react';
const buildRegistry = () => {
  const slot = useMemo(() => createRef(), []);
  return slot;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for createRef inside an event handler callback", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from 'react';
function Editor() {
  return <button onClick={() => { const scratch = createRef(); void scratch; }}>x</button>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
