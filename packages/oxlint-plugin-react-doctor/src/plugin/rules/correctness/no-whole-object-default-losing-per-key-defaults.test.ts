import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noWholeObjectDefaultLosingPerKeyDefaults } from "./no-whole-object-default-losing-per-key-defaults.js";

describe("no-whole-object-default-losing-per-key-defaults", () => {
  it("flags a multi-key whole-object default with undefaulted bindings", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const useActive = ({ exact, loading } = { exact: true, loading: false }) => {};`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a function declaration with a partial whole-object default", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `function setup({ path, type } = { path: '' }) {}`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a single-key whole-object default with an undefaulted binding", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `function useConvertD3ToBreadcrumbs({ data } = { data: someDefault }) {}`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags when only some bindings carry their own default", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const f = ({ a = 1, b } = { a: 1, b: 2 }) => {};`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when every binding already carries its own default", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const useNavLinks = ({ provider = p, owner = o } = { provider: p, owner: o }) => {};`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for the empty-object default idiom", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const fn = ({ a = 1, b = false } = {}) => {};`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a test-helper with every binding pre-defaulted", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `function setup({ triggerError = false, showStaticAnalysis = true, plan = free } = { triggerError: false, showStaticAnalysis: true, plan: free }) {}`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when there is no whole-object default at all", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const f = ({ a, b }) => {};`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a spread-only default object (no per-key value)", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const f = ({ a, b } = { ...base }) => {};`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a nested destructuring default as a parameter default", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const { a, b } = { a: 1 };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the default is not an object expression", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const f = ({ a, b } = base) => {};`
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
