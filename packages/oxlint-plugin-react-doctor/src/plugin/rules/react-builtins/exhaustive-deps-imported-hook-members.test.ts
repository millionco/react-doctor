import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { captureCrossFileProbes } from "../../utils/cross-file-probe-recorder.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

interface ImportedActionsCase {
  readonly producer?: string;
  readonly consumer?: string;
  readonly config?: unknown;
}

const producerSource = `import { useState } from "react";
  export function useCounterActions(value) {
    const [count, setCount] = useState(0);
    const increment = (step) => setCount((previous) => previous + step);
    const read = () => count;
    return { increment, read };
  }`;

const consumerSource = `import { useEffect } from "react";
  import { useCounterActions } from "./use-counter-actions.js";
  export const Panel = ({ value }) => {
    const actions = useCounterActions(value);
    useEffect(() => { actions.increment(1); }, []);
    return <output>{actions.read()}</output>;
  };`;

const runImportedActions = (input: ImportedActionsCase = {}) => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "rd-imported-actions-"));
  const filename = path.join(directory, "panel.jsx");
  try {
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ type: "module", dependencies: { react: "19.2.0" } }),
    );
    fs.writeFileSync(
      path.join(directory, "use-counter-actions.js"),
      input.producer ?? producerSource,
    );
    fs.writeFileSync(filename, input.consumer ?? consumerSource);
    if (input.config !== undefined)
      fs.writeFileSync(path.join(directory, "tsconfig.json"), JSON.stringify(input.config));
    resetFilesystemCaches();
    return runRule(exhaustiveDeps, input.consumer ?? consumerSource, { filename });
  } finally {
    resetFilesystemCaches();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

describe("exhaustive-deps imported setter-only members", () => {
  it("accepts a selected callback while its sibling reads render state", () => {
    expect(runImportedActions()).toEqual({ diagnostics: [], parseErrors: [] });
  });

  it("accepts an aliased React setter import", () => {
    const producer = producerSource
      .replace("{ useState }", "{ useState as useNumber }")
      .replace("= useState(0)", "= useNumber(0)");
    expect(runImportedActions({ producer })).toEqual({ diagnostics: [], parseErrors: [] });
  });

  it("accepts arguments as an ordinary property name", () => {
    const producer = producerSource.replace(
      "previous + step",
      "({ arguments: previous + step }).arguments",
    );
    expect(runImportedActions({ producer })).toEqual({ diagnostics: [], parseErrors: [] });
  });

  it("retains a missing argument dependency", () => {
    const consumer = consumerSource.replace("actions.increment(1)", "actions.increment(value)");
    const result = runImportedActions({ consumer });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("`value`");
    expect(result.diagnostics[0]?.message).not.toContain("actions.increment");
  });

  it("retains the reactive sibling dependency", () => {
    const consumer = consumerSource.replace("actions.increment(1)", "consume(actions.read())");
    const result = runImportedActions({ consumer });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("actions.read");
  });

  it.each([
    ["a prop capture", producerSource.replace("previous + step", "previous + value")],
    ["a render-state capture", producerSource.replace("previous + step", "count + step")],
    [
      "a hook-local helper capture",
      producerSource
        .replace("const increment", "const selected = () => value; const increment")
        .replace("previous + step", "selected() + step"),
    ],
    [
      "implicit lexical arguments",
      producerSource
        .replace("const increment", "arguments.selected = value; const increment")
        .replace("previous + step", "arguments.selected"),
    ],
    ["a this capture", producerSource.replace("previous + step", "this.selected + step")],
    [
      "a normal function callback",
      producerSource.replace(
        "(step) => setCount((previous) => previous + step)",
        "function(step) { setCount((previous) => previous + step); }",
      ),
    ],
    [
      "a getter result",
      producerSource.replace(
        "return { increment, read };",
        "return { get increment() { return () => setCount(value); }, read };",
      ),
    ],
    [
      "a spread result",
      producerSource.replace(
        "return { increment, read };",
        "return { increment, read, ...value };",
      ),
    ],
    [
      "a duplicate property",
      producerSource.replace(
        "return { increment, read };",
        "return { increment, read, increment: () => setCount(value) };",
      ),
    ],
    [
      "a computed result",
      producerSource.replace(
        "return { increment, read };",
        "return { ['increment']: increment, read };",
      ),
    ],
    [
      "a normal sibling method",
      producerSource.replace(
        "return { increment, read };",
        "return { increment, read() { this.increment = () => setCount(value); return count; } };",
      ),
    ],
    [
      "multiple returns",
      producerSource.replace(
        "return { increment, read };",
        "if (value) return { increment: () => setCount(value), read }; return { increment, read };",
      ),
    ],
    [
      "a reassigned exported function",
      producerSource +
        "\nuseCounterActions = (value) => ({ increment: () => consume(value), read: () => value });",
    ],
    [
      "a replaced state provider",
      producerSource.replace(
        'import { useState } from "react";',
        'import React, { useState } from "react"; React.__defineGetter__("useState", () => replacement);',
      ),
    ],
    [
      "a shadowed state provider",
      producerSource.replace(
        "const [count",
        "const useState = (initial) => [initial, (next) => consume(value, next)]; const [count",
      ),
    ],
  ])("retains the callback dependency for %s", (_description, producer) => {
    const result = runImportedActions({ producer });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("actions.increment");
  });

  it.each([
    ["a raw alias", "const alias = actions; consume(alias);"],
    ["a whole-record escape", "consume(actions);"],
    ["a method extraction", "const increment = actions.increment; consume(increment);"],
    ["an inherited accessor", 'actions.__defineGetter__("increment", () => () => consume(value));'],
    [
      "an inherited record alias",
      "const alias = actions.valueOf(); alias.increment = () => consume(value);",
    ],
    ["a direct member assignment", "actions.increment = () => consume(value);"],
    [
      "a destructuring member assignment",
      "({ increment: actions.increment } = { increment: () => consume(value) });",
    ],
    ["a loop member assignment", "for (actions.increment of [() => consume(value)]) {}"],
  ])("retains the dependency after %s", (_description, mutation) => {
    const consumer = consumerSource.replace("useEffect(()", `${mutation} useEffect(()`);
    const result = runImportedActions({ consumer });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("actions.increment");
  });

  it.each([
    ["a missing React alias", { compilerOptions: { paths: { react: ["./generated-react.js"] } } }],
    ["an empty React alias", { compilerOptions: { paths: { react: [] } } }],
    ["a malformed paths map", { compilerOptions: { paths: [] } }],
    ["an explicit base URL", { compilerOptions: { baseUrl: "." } }],
    ["a different JSX provider", { compilerOptions: { jsxImportSource: "custom-jsx" } }],
  ])("declines the bridge with %s", (_description, config) => {
    const result = runImportedActions({ config });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("actions.increment");
  });

  it("collects and replays every imported helper and inherited config probe", () => {
    const directory = fs.mkdtempSync(path.join(tmpdir(), "rd-imported-action-probes-"));
    const filename = path.join(directory, "panel.jsx");
    const helperDirectory = path.join(directory, "hooks");
    const helper = path.join(helperDirectory, "use-counter-actions.js");
    const helperConfig = path.join(helperDirectory, "tsconfig.json");
    const sharedConfig = path.join(directory, "react-config.json");
    const consumer = consumerSource.replace(
      "./use-counter-actions.js",
      "./hooks/use-counter-actions.js",
    );
    try {
      fs.mkdirSync(helperDirectory);
      fs.writeFileSync(
        path.join(directory, "package.json"),
        JSON.stringify({ type: "module", dependencies: { react: "19.2.0" } }),
      );
      fs.writeFileSync(filename, consumer);
      fs.writeFileSync(helper, producerSource);
      fs.writeFileSync(helperConfig, JSON.stringify({ extends: "../react-config.json" }));
      fs.writeFileSync(sharedConfig, JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }));
      resetFilesystemCaches();
      const captured = captureCrossFileProbes(() =>
        runRule(exhaustiveDeps, consumer, { filename }),
      );
      expect(captured.value).toEqual({ diagnostics: [], parseErrors: [] });
      expect(captured.trace.contentPaths).toContain(helper);
      expect(captured.trace.contentPaths).toContain(helperConfig);
      expect(captured.trace.contentPaths).toContain(sharedConfig);
      for (const shouldReset of [false, true]) {
        if (shouldReset) resetFilesystemCaches();
        const collected = collectCrossFileDependencyProbes({
          absoluteFilePath: filename,
          sourceText: consumer,
          ruleIds: ["exhaustive-deps"],
        });
        expect(collected).not.toBeNull();
        for (const contentPath of captured.trace.contentPaths)
          expect(collected?.contentPaths).toContain(contentPath);
        for (const existencePath of captured.trace.existencePaths)
          expect(collected?.existencePaths).toContain(existencePath);
      }
      fs.writeFileSync(
        sharedConfig,
        JSON.stringify({ compilerOptions: { paths: { react: ["./missing.js"] } } }),
      );
      resetFilesystemCaches();
      const aliased = runRule(exhaustiveDeps, consumer, { filename });
      expect(aliased.parseErrors).toEqual([]);
      expect(aliased.diagnostics).toHaveLength(1);
      fs.writeFileSync(sharedConfig, JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }));
      fs.writeFileSync(helper, producerSource.replace("previous + step", "previous + value"));
      resetFilesystemCaches();
      const stale = runRule(exhaustiveDeps, consumer, { filename });
      expect(stale.parseErrors).toEqual([]);
      expect(stale.diagnostics).toHaveLength(1);
    } finally {
      resetFilesystemCaches();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
