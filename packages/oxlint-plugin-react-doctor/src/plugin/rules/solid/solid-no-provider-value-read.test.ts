import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidNoProviderValueRead } from "./solid-no-provider-value-read.js";

describe("solid-no-provider-value-read", () => {
  it("flags signal call as provider value", () => {
    const result = runRule(
      solidNoProviderValueRead,
      `const App = () => <ThemeProvider value={theme()} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("theme");
    expect(result.diagnostics[0].message).toContain("accessor");
  });

  it("flags member-expression Provider", () => {
    const result = runRule(
      solidNoProviderValueRead,
      `const App = () => <Ctx.Provider value={count()} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag accessor passed directly", () => {
    const result = runRule(
      solidNoProviderValueRead,
      `const App = () => <ThemeProvider value={theme} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag object literal value", () => {
    const result = runRule(
      solidNoProviderValueRead,
      `const App = () => <ThemeProvider value={{ count, setCount }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag non-Provider elements", () => {
    const result = runRule(
      solidNoProviderValueRead,
      `const App = () => <Input value={count()} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag calls with arguments", () => {
    const result = runRule(
      solidNoProviderValueRead,
      `const App = () => <ThemeProvider value={getTheme("dark")} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags member-expression accessor call", () => {
    const result = runRule(
      solidNoProviderValueRead,
      `const App = () => <Ctx.Provider value={store.count()} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("store.count");
  });
});
