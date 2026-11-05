import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLoadingFlagResetOutsideFinally } from "./no-loading-flag-reset-outside-finally.js";

const DEFAULT_PROPS = `export interface SubmitProps {
  onSubmit?: () => Promise<void> | void;
}`;
const ATTACH_RESET = "result.then(reset);";

let projectDirectory: string;

beforeEach(() => {
  projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-loading-fulfillment-"));
});

afterEach(() => {
  fs.rmSync(projectDirectory, { recursive: true, force: true });
});

const renderFixture = (settlement: string, reactImport: string, preamble: string) => `
  import { forwardRef, useCallback, useState } from "${reactImport}";
  import type { SubmitProps } from "./props";
  ${preamble}
  export const SubmitButton = forwardRef<HTMLButtonElement, SubmitProps>(({ onSubmit }, ref) => {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const reset = useCallback(() => {
      announceCompletion();
      setIsSubmitting(false);
    }, []);
    const handleSubmit = useCallback(() => {
      if (!onSubmit) return;
      const result = onSubmit();
      if (result) {
        setIsSubmitting(true);
        ${settlement}
      } else {
        reset();
      }
    }, [onSubmit, reset]);
    return <button ref={ref} disabled={isSubmitting} onClick={handleSubmit}>Submit</button>;
  });
`;

const analyze = (
  settlement = ATTACH_RESET,
  props = DEFAULT_PROPS,
  reactImport = "react",
  preamble = "",
  transform = (source: string) => source,
) => {
  fs.writeFileSync(path.join(projectDirectory, "props.ts"), props);
  const source = transform(renderFixture(settlement, reactImport, preamble));
  return runRule(noLoadingFlagResetOutsideFinally, source, {
    filename: path.join(projectDirectory, "SubmitButton.tsx"),
  });
};

describe("loading flag reset on promise fulfillment", () => {
  it("reports when a declared promise-returning prop clears the flag only on fulfillment", () => {
    const result = analyze();
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "result.finally(reset);",
    "result.then(reset, reset);",
    "result.then(reset).catch(reset);",
    "result.then(reset); result.catch(reset);",
    "return result.then(reset);",
    "const chained = result.then(reset); consume(chained);",
    "result.then(reset); reset();",
    "result.then(unrelated);",
  ])("leaves a different or escaped settlement path quiet: %s", (settlement) => {
    const result = analyze(settlement);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    "export interface SubmitProps { onSubmit?: () => { then(callback: () => void): void } | void; }",
    "export interface SubmitProps { onSubmit?: () => PromiseLike<void> | void; }",
    "interface Base { onSubmit?: () => Promise<void> | void; } export interface SubmitProps extends Base {}",
    "export interface SubmitProps { onSubmit?: () => Promise<void> | void; } export interface SubmitProps { other?: boolean; }",
    "interface Promise<Value> { then(): Value; } export interface SubmitProps { onSubmit?: () => Promise<void> | void; }",
    "export interface SubmitProps { onSubmit?(): Promise<void> | void; }",
  ])("does not assume an ambiguous or non-Promise prop contract: %s", (props) => {
    const result = analyze(ATTACH_RESET, props);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("preserves a rejection reset through a differently named callback", () => {
    const result = analyze(
      "result.then(reset, handleFailure);",
      DEFAULT_PROPS,
      "react",
      "",
      (source) =>
        source.replace(
          "const handleSubmit =",
          "const handleFailure = () => setIsSubmitting(false); const handleSubmit =",
        ),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("preserves an outer finally that clears the flag for the guarded branch", () => {
    const result = analyze(ATTACH_RESET, DEFAULT_PROPS, "react", "", (source) =>
      source
        .replace("if (result) {", "try { if (result) {")
        .replace("}, [onSubmit, reset]);", "} finally { reset(); } }, [onSubmit, reset]);"),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not spend the await analysis budget on fulfillment prop declarations", () => {
    const fixtureNames = ["Basic", "Compact", "Expanded"];
    const components = fixtureNames.map((fixtureName) => {
      fs.writeFileSync(path.join(projectDirectory, `props-${fixtureName}.ts`), DEFAULT_PROPS);
      return renderFixture(ATTACH_RESET, "react", "")
        .replace('import { forwardRef, useCallback, useState } from "react";', "")
        .replace(
          'import type { SubmitProps } from "./props";',
          `import type { SubmitProps as ${fixtureName}Props } from "./props-${fixtureName}";`,
        )
        .replace("HTMLButtonElement, SubmitProps", `HTMLButtonElement, ${fixtureName}Props`)
        .replace("const SubmitButton =", `const ${fixtureName}SubmitButton =`);
    });
    fs.writeFileSync(
      path.join(projectDirectory, "requests.ts"),
      `export const safeRequest = async () => { try { await send(); } catch {} };
       export const unsafeRequest = async () => { await send(); };`,
    );
    const source = `
      import { forwardRef, useCallback, useState } from "react";
      import { safeRequest, unsafeRequest } from "./requests";
      ${components.join("\n")}
      const submitSafely = async () => {
        setLoadingSafe(true);
        await safeRequest();
        setLoadingSafe(false);
      };
      const submitUnsafely = async () => {
        setLoadingUnsafe(true);
        await unsafeRequest();
        setLoadingUnsafe(false);
      };`;
    const result = runRule(noLoadingFlagResetOutsideFinally, source, {
      filename: path.join(projectDirectory, "SubmitButton.tsx"),
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(4);
    const lines = result.diagnostics.map((diagnostic) => diagnostic.line);
    expect(lines).toContain(
      source.split("\n").findIndex((line) => line.includes("setLoadingUnsafe(false)")) + 1,
    );
    expect(lines).not.toContain(
      source.split("\n").findIndex((line) => line.includes("setLoadingSafe(false)")) + 1,
    );
  });

  it("does not use generics from a foreign component wrapper", () => {
    const result = analyze(ATTACH_RESET, DEFAULT_PROPS, "foreign-ui");
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a mutable result or an escaping reset helper as a closed chain", () => {
    const mutable = analyze(ATTACH_RESET, DEFAULT_PROPS, "react", "", (source) =>
      source.replace("const result", "let result"),
    );
    const escaping = analyze(ATTACH_RESET, DEFAULT_PROPS, "react", "", (source) =>
      source.replace("if (!onSubmit) return;", "registerReset(reset); if (!onSubmit) return;"),
    );
    expect(mutable.parseErrors).toEqual([]);
    expect(escaping.parseErrors).toEqual([]);
    expect(mutable.diagnostics).toHaveLength(0);
    expect(escaping.diagnostics).toHaveLength(0);
  });

  it.each([
    "Promise.prototype.then = replacement;",
    "class WrappedPromise extends Promise<void> { then(fulfilled) { return super.then(fulfilled, fulfilled); } }",
    "const wrapped = { then(fulfilled) { fulfilled(); } };",
    "class WrappedPromise extends Promise<void> { [name]() {} }",
    "const { __proto__: prototype } = (async () => {})(); prototype.__defineGetter__('then', replacement);",
    "const key = getKey(); const { [key]: prototype } = (async () => {})(); install(prototype);",
    "const host = document.defaultView; const reflective = host[reflectionKey]; install(reflective);",
    "const reflective = window.Reflect; reflective[method]((async () => {})());",
    'import React from "react"; React.useState = replacement;',
    'import React from "react"; React[computeMethod()] = replacement;',
  ])("does not assume standard settlement after visible provider mutation: %s", (preamble) => {
    const result = analyze(ATTACH_RESET, DEFAULT_PROPS, "react", preamble);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
