import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noInlinePropOnMemoComponent } from "./no-inline-prop-on-memo-component.js";

const expectFail = (code: string): void => {
  const result = runRule(noInlinePropOnMemoComponent, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(noInlinePropOnMemoComponent, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

const memoConsumer = (jsx: string): string =>
  `import { memo } from "react";\nconst Field = memo(function Field(props){ return <input {...props} />; });\n${jsx}`;

describe("performance/no-inline-prop-on-memo-component — regressions", () => {
  it("flags an inline function prop on a memoized component", () => {
    expectFail(memoConsumer(`function Form(){ return <Field onChange={() => save()} />; }`));
  });

  it("does not flag an inline `ref` callback (ref is not a memo-compared prop)", () => {
    expectPass(
      memoConsumer(`function Form(){ return <Field ref={(el)=>{ fieldRef.current = el; }} />; }`),
    );
  });
});
