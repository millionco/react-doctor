import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoSetNativeProps } from "./rn-no-set-native-props.js";

describe("rn-no-set-native-props", () => {
  it("flags ref.current.setNativeProps(...)", () => {
    const code = `inputRef.current.setNativeProps({ text: value });`;
    const result = runRule(rnNoSetNativeProps, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("New Architecture");
  });

  it("flags the optional-chained ref.current?.setNativeProps(...)", () => {
    const code = `textInputRef.current?.setNativeProps({ selection: { start, end } });`;
    const result = runRule(rnNoSetNativeProps, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags this.viewRef.current.setNativeProps(...)", () => {
    const code = `this.rootViewRef.current.setNativeProps({ style: { opacity: 0 } });`;
    const result = runRule(rnNoSetNativeProps, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a chained current access (a.current?.b.current?.setNativeProps)", () => {
    const code = `inputRef.current?.textInputRef.current?.setNativeProps({ selection });`;
    const result = runRule(rnNoSetNativeProps, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag an uncalled member access", () => {
    const code = `const fn = ref.current.setNativeProps;`;
    const result = runRule(rnNoSetNativeProps, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag setNativeProps on a non-.current receiver", () => {
    const code = `config.setNativeProps({ text });`;
    const result = runRule(rnNoSetNativeProps, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a callback-ref setNativeProps (no .current) — out of v1 scope", () => {
    const code = `iconRef.setNativeProps({ opacity: 0.5 });`;
    const result = runRule(rnNoSetNativeProps, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag other imperative ref methods", () => {
    const code = `inputRef.current.focus();`;
    const result = runRule(rnNoSetNativeProps, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
