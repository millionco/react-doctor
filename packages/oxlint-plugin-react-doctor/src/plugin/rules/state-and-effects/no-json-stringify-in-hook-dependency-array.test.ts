import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noJsonStringifyInHookDependencyArray } from "./no-json-stringify-in-hook-dependency-array.js";

describe("no-json-stringify-in-hook-dependency-array", () => {
  it("flags JSON.stringify in a useEffect dep array", () => {
    const result = runRule(
      noJsonStringifyInHookDependencyArray,
      `useEffect(() => { syncSelection(values); }, [JSON.stringify(values)]);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags JSON.stringify in a useMemo dep array", () => {
    const result = runRule(
      noJsonStringifyInHookDependencyArray,
      `const selected = useMemo(() => computeSelected(fixtureState), [JSON.stringify(fixtureState)]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags JSON.stringify in a useCallback dep array", () => {
    const result = runRule(
      noJsonStringifyInHookDependencyArray,
      `const onChange = useCallback(() => { emit(options); }, [JSON.stringify(options)]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags JSON.stringify in a useLayoutEffect dep array", () => {
    const result = runRule(
      noJsonStringifyInHookDependencyArray,
      `useLayoutEffect(() => { run(); }, [JSON.stringify(a)]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags JSON.stringify in a useImperativeHandle deps (3rd arg)", () => {
    const result = runRule(
      noJsonStringifyInHookDependencyArray,
      `useImperativeHandle(ref, () => ({ focus() {} }), [JSON.stringify(state)]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags each JSON.stringify element separately", () => {
    const result = runRule(
      noJsonStringifyInHookDependencyArray,
      `useEffect(() => {}, [JSON.stringify(a), JSON.stringify(b)]);`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not flag JSON.stringify inside a template string", () => {
    const result = runRule(
      noJsonStringifyInHookDependencyArray,
      `const cacheKey = \`earn-\${JSON.stringify(params)}\`;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag JSON.stringify in a non-hook array literal", () => {
    const result = runRule(
      noJsonStringifyInHookDependencyArray,
      `const key = [endpoint, JSON.stringify(body)];`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag JSON.stringify inside the effect body", () => {
    const result = runRule(
      noJsonStringifyInHookDependencyArray,
      `useEffect(() => { const s = JSON.stringify(values); send(s); }, [values]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag JSON.stringify nested inside a dep expression", () => {
    const result = runRule(
      noJsonStringifyInHookDependencyArray,
      `useEffect(() => {}, [\`k-\${JSON.stringify(values)}\`]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a shadowed JSON['stringify'] computed access", () => {
    const result = runRule(
      noJsonStringifyInHookDependencyArray,
      `useEffect(() => {}, [JSON["stringify"](values)]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a plain stringify() call from another binding", () => {
    const result = runRule(
      noJsonStringifyInHookDependencyArray,
      `useEffect(() => {}, [stringify(values)]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
