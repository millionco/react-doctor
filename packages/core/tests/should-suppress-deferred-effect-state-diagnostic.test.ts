import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { parseOxlintOutput } from "../src/runners/oxlint/parse-output.js";
import { createDeferredEffectStateDiagnosticChecker } from "../src/runners/oxlint/should-suppress-deferred-effect-state-diagnostic.js";
import { buildProject } from "./helpers/oxlint-parse-harness.js";

let temporaryRoot: string;

const shouldSuppressDeferredEffectStateDiagnostic = (
  diagnostic: Parameters<ReturnType<typeof createDeferredEffectStateDiagnosticChecker>>[0],
  rootDirectory: string,
): boolean => createDeferredEffectStateDiagnosticChecker(rootDirectory)(diagnostic);

beforeEach(() => {
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deferred-effect-state-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

const SAFE_HELPER = "async () => { try { setValue(await read()); } catch { setValue(-1); } }";

const buildSource = (
  producer = "async () => 1",
  helper = SAFE_HELPER,
  effect = "() => { void refresh(); }",
): string => `import { useState, useEffect, useCallback } from "react";
export const Example = () => {
  const [value, setValue] = useState(0);
  const read = ${producer};
  const refresh = ${helper};
  useEffect(${effect}, [refresh]);
  return <span>{value}</span>;
};
`;

const diagnosticAt = (source: string, needle = "refresh();") => {
  const prefix = source.slice(0, source.lastIndexOf(needle));
  return {
    code: "react-hooks-js(set-state-in-effect)",
    filename: "example.tsx",
    labels: [
      {
        span: {
          offset: Buffer.byteLength(prefix),
          length: "refresh".length,
          line: prefix.split("\n").length,
          column: (prefix.split("\n").at(-1)?.length ?? 0) + 1,
        },
      },
    ],
  };
};

const inspectSource = (source: string): boolean => {
  fs.writeFileSync(path.join(temporaryRoot, "example.tsx"), source);
  return shouldSuppressDeferredEffectStateDiagnostic(diagnosticAt(source), temporaryRoot);
};

describe("shouldSuppressDeferredEffectStateDiagnostic", () => {
  it.each([
    ["direct local helper", buildSource()],
    ["memoized helper", buildSource("async () => 1", `useCallback(${SAFE_HELPER}, [])`)],
    ["literal-returning async function", buildSource("async function () { return null; }")],
    ["signed numeric producer", buildSource("async () => -1")],
    ["positive numeric fallback", buildSource().replace("setValue(-1)", "setValue(+1)")],
    ["string literal producer", buildSource('async () => "ready"')],
    ["boolean producer", buildSource("async () => false")],
    [
      "transparent expressions",
      buildSource().replace("setValue(await read())", "(setValue)((await (read)()) as number)"),
    ],
    ["BOM prefix", "\uFEFF" + buildSource()],
    ["UTF-8 prefix", 'const heading = "🧭";\n' + buildSource()],
    [
      "renamed React imports",
      buildSource()
        .replaceAll("useState", "localState")
        .replaceAll("useEffect", "localEffect")
        .replaceAll("useCallback", "localCallback")
        .replace(
          "{ localState, localEffect, localCallback }",
          "{ useState as localState, useEffect as localEffect, useCallback as localCallback }",
        ),
    ],
  ])("suppresses %s", (_name, source) => {
    expect(inspectSource(source)).toBe(true);
  });

  it.each([
    ["nonasync producer", buildSource("() => { throw new Error('synthetic'); }")],
    ["producer with a synchronous setter", buildSource("async () => { setValue(7); return 1; }")],
    ["opaque producer call", buildSource("async () => notify()")],
    ["producer default parameter", buildSource("async (value = notify()) => 1")],
    ["async generator producer", buildSource("async function* () { return 1; }")],
    ["producer getter argument", buildSource().replace("await read()", "await read(source.value)")],
    ["producer spread argument", buildSource().replace("await read()", "await read(...values)")],
    [
      "pre-await setter",
      buildSource(
        "async () => 1",
        "async () => { setValue(0); try { setValue(await read()); } catch { setValue(-1); } }",
      ),
    ],
    ["throwing try prefix", buildSource().replace("try { setValue", "try { notify(); setValue")],
    [
      "finally setter",
      buildSource().replace(
        "catch { setValue(-1); }",
        "catch { setValue(-1); } finally { setValue(2); }",
      ),
    ],
    ["different catch setter", buildSource().replace("setValue(-1)", "otherSetter(-1)")],
    ["throwing catch argument", buildSource().replace("setValue(-1)", "setValue(source.value)")],
    ["catch binding", buildSource().replace("catch {", "catch (read) {")],
    [
      "helper default parameter",
      buildSource("async () => 1", SAFE_HELPER.replace("async ()", "async (input = notify())")),
    ],
    [
      "helper generator",
      buildSource(
        "async () => 1",
        "async function* () { try { setValue(await read()); } catch { setValue(-1); } }",
      ),
    ],
    [
      "helper loop",
      buildSource(
        "async () => 1",
        "async () => { while (active) { try { setValue(await read()); } catch { setValue(-1); } } }",
      ),
    ],
    [
      "extra effect writer",
      buildSource("async () => 1", SAFE_HELPER, "() => { setValue(0); void refresh(); }"),
    ],
    [
      "conditional effect helper call",
      buildSource("async () => 1", SAFE_HELPER, "() => { if (active) void refresh(); }"),
    ],
    [
      "effect call arguments",
      buildSource("async () => 1", SAFE_HELPER, "() => { void refresh(source.value); }"),
    ],
    ["async effect", buildSource("async () => 1", SAFE_HELPER, "async () => { void refresh(); }")],
    ["mutable producer", buildSource().replace("const read", "let read")],
    [
      "uninitialized producer after return",
      buildSource()
        .replace("  const read = async () => 1;\n", "")
        .replace(
          "  return <span>{value}</span>;",
          "  return <span>{value}</span>;\n  const read = async () => 1;",
        ),
    ],
    ["mutable helper", buildSource().replace("const refresh", "let refresh")],
    ["mutable setter binding", buildSource().replace("const [value", "let [value")],
    [
      "helper alias escape",
      buildSource().replace("  useEffect(", "  const escaped = refresh;\n  useEffect("),
    ],
    ["producer escape", buildSource().replace("  useEffect(", "  consume(read);\n  useEffect(")],
    ["setter escape", buildSource().replace("  useEffect(", "  consume(setValue);\n  useEffect(")],
    ["shadowed producer", buildSource() + "function other(read) { return read(); }"],
    ["shadowed setter", buildSource() + "function other(setValue) { return setValue(); }"],
    ["shadowed React hook", buildSource() + "function other(useState) { return useState(); }"],
    [
      "foreign state provider",
      buildSource().replace(
        "  const [value, setValue] = useState(0);",
        "  const [value, setValue] = foreignState(0);",
      ),
    ],
    ["foreign memo wrapper", buildSource("async () => 1", `foreignMemo(${SAFE_HELPER}, [])`)],
    [
      "nonempty memo dependencies",
      buildSource("async () => 1", `useCallback(${SAFE_HELPER}, [input])`),
    ],
    ["React namespace mutation route", 'import * as React from "react";\n' + buildSource()],
    ["type-only React imports", buildSource().replace("import {", "import type {")],
    ["direct eval", buildSource() + "const unused = () => eval('synthetic');"],
    ["dynamic function", buildSource() + "const unused = new Function('return 1');"],
    ["dynamic module", buildSource() + "const unused = () => import('react');"],
    [
      "Promise constructor reflection",
      buildSource().replace(
        "  useEffect(",
        "  Object.defineProperty(Promise.prototype, 'constructor', { get() { throw new Error('synthetic'); } });\n  useEffect(",
      ),
    ],
    ["computed global reflection", buildSource() + "const unused = globalThis['Promise'];"],
    ["prototype access", buildSource() + "const unused = provider.prototype;"],
    ["computed constructor access", buildSource() + "const unused = provider['constructor'];"],
    ["unknown require provider", buildSource() + "const unused = () => require('react');"],
    ["optional helper call", buildSource().replace("void refresh();", "void refresh?.();")],
    ["optional producer call", buildSource().replace("await read()", "await read?.()")],
    [
      "generator owner",
      buildSource()
        .replace("export const Example = () => {", "export function* Example() {")
        .replace(/};\s*$/, "}"),
    ],
    ["invalid syntax", buildSource() + "const broken = ;"],
  ])("retains %s", (_name, source) => {
    expect(inspectSource(source)).toBe(false);
  });

  it("retains diagnostics when source is unavailable", () => {
    expect(
      shouldSuppressDeferredEffectStateDiagnostic(diagnosticAt(buildSource()), temporaryRoot),
    ).toBe(false);
  });

  it("requires the exact callee byte span and diagnostic code", () => {
    const source = buildSource();
    fs.writeFileSync(path.join(temporaryRoot, "example.tsx"), source);
    const diagnostic = diagnosticAt(source);
    expect(
      shouldSuppressDeferredEffectStateDiagnostic(
        { ...diagnostic, code: "react-hooks-js(set-state-in-render)" },
        temporaryRoot,
      ),
    ).toBe(false);
    expect(
      shouldSuppressDeferredEffectStateDiagnostic(
        {
          ...diagnostic,
          labels: [{ span: { offset: diagnostic.labels[0].span.offset + 1, length: 7 } }],
        },
        temporaryRoot,
      ),
    ).toBe(false);
    expect(
      shouldSuppressDeferredEffectStateDiagnostic(
        {
          ...diagnostic,
          labels: [{ span: { offset: diagnostic.labels[0].span.offset, length: 8 } }],
        },
        temporaryRoot,
      ),
    ).toBe(false);
    expect(
      shouldSuppressDeferredEffectStateDiagnostic({ ...diagnostic, labels: [] }, temporaryRoot),
    ).toBe(false);
  });

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "retains a malformed callee span length %s",
    (length) => {
      const source = buildSource();
      fs.writeFileSync(path.join(temporaryRoot, "example.tsx"), source);
      const diagnostic = diagnosticAt(source);
      diagnostic.labels[0].span.length = length;
      expect(shouldSuppressDeferredEffectStateDiagnostic(diagnostic, temporaryRoot)).toBe(false);
    },
  );

  it("retains a UTF-8 offset inside a multibyte callee", () => {
    const source = buildSource().replaceAll("refresh", "réfresh");
    fs.writeFileSync(path.join(temporaryRoot, "example.tsx"), source);
    const diagnostic = diagnosticAt(source, "réfresh();");
    diagnostic.labels[0].span.length = Buffer.byteLength("réfresh");
    const check = createDeferredEffectStateDiagnosticChecker(temporaryRoot);
    expect(check(diagnostic)).toBe(true);
    diagnostic.labels[0].span.offset += 2;
    expect(check(diagnostic)).toBe(false);
  });

  it("bounds byte-prefix work independently of unrelated call count", () => {
    const unrelatedCalls = "unrelated();\n".repeat(2_000);
    const source = buildSource().replace("  const read =", unrelatedCalls + "  const read =");
    fs.writeFileSync(path.join(temporaryRoot, "example.tsx"), source);
    const diagnostic = diagnosticAt(source);
    const byteLength = vi.spyOn(Buffer, "byteLength");
    expect(shouldSuppressDeferredEffectStateDiagnostic(diagnostic, temporaryRoot)).toBe(true);
    expect(byteLength).toHaveBeenCalledTimes(2);
    expect(
      byteLength.mock.calls.reduce(
        (total, [text]) => total + (typeof text === "string" ? text.length : text.byteLength),
        0,
      ),
    ).toBeLessThanOrEqual(source.length);
  });

  it("reuses a parsed snapshot only within its checker", () => {
    const source = buildSource();
    const filename = path.join(temporaryRoot, "example.tsx");
    fs.writeFileSync(filename, source);
    const diagnostic = diagnosticAt(source);
    const check = createDeferredEffectStateDiagnosticChecker(temporaryRoot);
    expect(check(diagnostic)).toBe(true);
    fs.unlinkSync(filename);
    expect(check(diagnostic)).toBe(true);
    expect(createDeferredEffectStateDiagnosticChecker(temporaryRoot)(diagnostic)).toBe(false);
    fs.writeFileSync(filename, source.replace("async () => 1", "() => 1"));
    expect(
      createDeferredEffectStateDiagnosticChecker(temporaryRoot)(
        diagnosticAt(fs.readFileSync(filename, "utf8")),
      ),
    ).toBe(false);
  });

  it("applies the source certificate through the existing diagnostic pipeline", () => {
    const source = buildSource();
    fs.writeFileSync(path.join(temporaryRoot, "example.tsx"), source);
    const diagnostic = {
      ...diagnosticAt(source),
      message: "Calling setState synchronously within an effect can trigger cascading renders",
      severity: "warning",
      help: "",
      url: "",
      causes: [],
      related: [],
    };
    const stdout = JSON.stringify({
      diagnostics: [diagnostic],
      number_of_files: 1,
      number_of_rules: 1,
    });
    expect(parseOxlintOutput(stdout, buildProject(), temporaryRoot)).toEqual([]);
    const unsafeSource = source.replace("async () => 1", "() => 1");
    fs.writeFileSync(path.join(temporaryRoot, "example.tsx"), unsafeSource);
    const unsafeStdout = JSON.stringify({
      diagnostics: [{ ...diagnostic, ...diagnosticAt(unsafeSource) }],
      number_of_files: 1,
      number_of_rules: 1,
    });
    expect(parseOxlintOutput(unsafeStdout, buildProject(), temporaryRoot)).toHaveLength(1);
  });
});
