import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noChainStateUpdates } from "./no-chain-state-updates.js";

describe("native bare computed-style reads", () => {
  it.each([
    ["const { label } = props;", "setShade(getComputedStyle(surfaceRef.current).opacity);"],
    [
      'const { ["label"]: label, ...rest } = props;',
      "setShade(getComputedStyle(surfaceRef.current).opacity);",
    ],
    ["const { ...rest } = props;", "setShade(getComputedStyle(surfaceRef.current).opacity);"],
    [
      "const options = { constructor: customReader };",
      "setShade(getComputedStyle(surfaceRef.current).opacity);",
    ],
    ["", "setShade(getComputedStyle(surfaceRef.current).opacity);"],
    ["", "setShade((getComputedStyle as typeof getComputedStyle)(surfaceRef.current).opacity);"],
    ["", "const style = getComputedStyle(surfaceRef.current); setShade(style.opacity);"],
    [
      "const readShade = element => getComputedStyle(element).opacity;",
      "setShade(readShade(surfaceRef.current));",
    ],
    [
      "",
      "const readShade = () => getComputedStyle(surfaceRef.current).opacity; setShade(readShade());",
    ],
    ["", 'try { setShade(getComputedStyle(surfaceRef.current).opacity); } catch { setShade(""); }'],
  ])("allows the measured state through %s %s", (setup, statements) => {
    const result = runRule(
      noChainStateUpdates,
      `import { useEffect, useRef, useState } from "react";
${setup}
const ShadeMeter = () => {
  const surfaceRef = useRef(null);
  const [step, setStep] = useState(0);
  const [shade, setShade] = useState("");
  useEffect(() => {
    if (surfaceRef.current) { ${statements} }
  }, [step]);
  return <section ref={surfaceRef} className={String(step)}>
    <button onClick={() => setStep(previous => previous + 1)}>Measure</button>
    <output>{shade}</output>
  </section>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "getComputedStyle = customReader;",
    "getComputedStyle += customReader;",
    "getComputedStyle++;",
    "window.getComputedStyle = customReader;",
    "globalThis.getComputedStyle = customReader;",
    "self.getComputedStyle = customReader;",
    "delete window.getComputedStyle;",
    "const realm = window;",
    "const { getComputedStyle: readStyle } = globalThis;",
    "const readStyle = getComputedStyle;",
    "consume(getComputedStyle);",
    "getComputedStyle.bind(window);",
    "new Function(source);",
    'const { ["constructor"]: compile } = () => {}; compile(payload)();',
    "const { [`constructor`]: compile } = () => {}; compile(payload)();",
    "const { [constructorKey]: compile } = () => {}; compile(payload)();",
    "const { prototype: nativePrototype } = provider;",
    "const { __proto__: nativePrototype } = provider;",
    `const { constructor: compile } = () => {}; compile("getComputedStyle = () => ({ opacity: 'fixed' })")();`,
    "Object.defineProperties(window, { getComputedStyle: { value: customReader } });",
    'Object.defineProperty(window, "getComputedStyle", { value: customReader });',
    "Object.assign(globalThis, { getComputedStyle: customReader });",
    'Reflect.set(globalThis, "getComputedStyle", customReader);',
    'Reflect.defineProperty(window, "getComputedStyle", { value: customReader });',
    "Reflect.setPrototypeOf(globalThis, replacement);",
    "window[methodName] = customReader;",
    "getRealm().getComputedStyle = customReader;",
    "({ reader: foreignView.getComputedStyle } = replacements);",
    "[foreignView.getComputedStyle] = replacements;",
    "[foreignView.getComputedStyle = customReader] = replacements;",
    "[...foreignView.getComputedStyle] = replacements;",
    "for (foreignView.getComputedStyle of replacements) {}",
    "for (foreignView.getComputedStyle in replacements) {}",
    "({ reader: foreignView[methodName] } = replacements);",
    "for (foreignView[methodName] of replacements) {}",
    "record[methodName] = customReader;",
    "Window.prototype.getComputedStyle = customReader;",
    "globalThis.window.getComputedStyle = customReader;",
    'eval("getComputedStyle = customReader");',
  ])("declines visible provider exposure: %s", (setup) => {
    const result = runRule(
      noChainStateUpdates,
      `import { useEffect, useRef, useState } from "react";
${setup}
const ShadeMeter = () => {
  const surfaceRef = useRef(null);
  const [step, setStep] = useState(0);
  const [shade, setShade] = useState("");
  useEffect(() => {
    if (surfaceRef.current) setShade(getComputedStyle(surfaceRef.current).opacity);
  }, [step]);
  return <section ref={surfaceRef}>
    <button onClick={() => setStep(previous => previous + 1)}>{shade}{step}</button>
  </section>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["class getComputedStyle {}", "getComputedStyle(surfaceRef.current).opacity"],
    ["", "((getComputedStyle) => getComputedStyle(surfaceRef.current).opacity)(customReader)"],
    ["", "(() => getComputedStyle(surfaceRef.current).opacity)"],
    ["", '"fixed"'],
    ["const getComputedStyle = customReader;", "getComputedStyle(surfaceRef.current).opacity"],
    [
      "function getComputedStyle() { return { opacity: value }; }",
      "getComputedStyle(surfaceRef.current).opacity",
    ],
    [
      'import { getComputedStyle } from "style-provider";',
      "getComputedStyle(surfaceRef.current).opacity",
    ],
    ["", "getComputedStyle"],
    ["const readStyle = getComputedStyle;", "readStyle(surfaceRef.current).opacity"],
    ["", "getComputedStyle?.(surfaceRef.current).opacity"],
    ["", "getComputedStyle.call(null, surfaceRef.current).opacity"],
    [
      "const readShade = element => { getComputedStyle(element); return value; };",
      "readShade(surfaceRef.current)",
    ],
    ["", '({ read: () => getComputedStyle(surfaceRef.current).opacity, value: "fixed" })'],
    ["", '(getComputedStyle(surfaceRef.current), "fixed")'],
    ["", "void getComputedStyle(surfaceRef.current)"],
  ])("keeps unsupported value paths reportable: %s %s", (setup, expression) => {
    const result = runRule(
      noChainStateUpdates,
      `import { useEffect, useRef, useState } from "react";
${setup}
const ShadeMeter = () => {
  const surfaceRef = useRef(null);
  const [step, setStep] = useState(0);
  const [shade, setShade] = useState("");
  useEffect(() => {
    if (surfaceRef.current) setShade(${expression});
  }, [step]);
  return <section ref={surfaceRef}>
    <button onClick={() => setStep(previous => previous + 1)}>{shade}{step}</button>
  </section>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["", "window.getComputedStyle(surfaceRef.current).opacity"],
    ["", "globalThis.getComputedStyle(surfaceRef.current).opacity"],
    ["const window = data;", "window.getComputedStyle(surfaceRef.current).opacity"],
    ["", "data.getComputedStyle(surfaceRef.current).opacity"],
  ])("preserves legacy member results: %s %s", (setup, expression) => {
    const result = runRule(
      noChainStateUpdates,
      `import { useEffect, useRef, useState } from "react";
${setup}
const ShadeMeter = () => {
  const surfaceRef = useRef(null);
  const [step, setStep] = useState(0);
  const [shade, setShade] = useState("");
  useEffect(() => {
    if (surfaceRef.current) setShade(${expression});
  }, [step]);
  return <section ref={surfaceRef}>
    <button onClick={() => setStep(previous => previous + 1)}>{shade}{step}</button>
  </section>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not exempt an unrelated state written by the same effect", () => {
    const result = runRule(
      noChainStateUpdates,
      `import { useEffect, useRef, useState } from "react";
const ShadeMeter = () => {
  const surfaceRef = useRef(null);
  const [step, setStep] = useState(0);
  const [shade, setShade] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (surfaceRef.current) setShade(getComputedStyle(surfaceRef.current).opacity);
    setReady(true);
  }, [step]);
  return <section ref={surfaceRef}>
    <button onClick={() => setStep(previous => previous + 1)}>{shade}{ready}{step}</button>
  </section>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.nodeType).toBe("CallExpression");
  });
});
