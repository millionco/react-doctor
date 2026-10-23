import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

const producer = `import React from "react";
  export const useCounterActions = () => {
    const [, setCount] = React.useState(0);
    const increment = (step) => setCount((previous) => previous + step);
    return { increment };
  };`;

const runCaller = (
  providerUse: string,
  reactImport = 'import React, { useEffect } from "react";',
) => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "rd-imported-caller-provider-"));
  const filename = path.join(directory, "panel.jsx");
  const consumer = `${reactImport}
    import { useCounterActions } from "./use-counter-actions.js";
    export const Panel = ({ value, replaceProvider }) => {
      ${providerUse}
      const actions = useCounterActions();
      useEffect(() => { actions.increment(1); }, []);
      return React.createElement("output", null);
    };`;
  try {
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ type: "module", dependencies: { react: "19.2.0" } }),
    );
    fs.writeFileSync(path.join(directory, "use-counter-actions.js"), producer);
    fs.writeFileSync(filename, consumer);
    resetFilesystemCaches();
    return runRule(exhaustiveDeps, consumer, { filename });
  } finally {
    resetFilesystemCaches();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

describe("exhaustive-deps imported callback caller providers", () => {
  it.each([
    ["no provider access", ""],
    ["an ordinary React method", 'const element = React.createElement("span");'],
    ["unrelated provider metadata", "const label = React.version;"],
    [
      "a shadowed local require",
      'const require = () => ({ version: "local" }); const metadata = require("react");',
    ],
  ])("accepts the setter-only method with %s", (_description, providerUse) => {
    expect(runCaller(providerUse)).toEqual({ diagnostics: [], parseErrors: [] });
  });

  it.each([
    ["direct replacement", "React.useState = () => [0, () => consume(value)];"],
    [
      "conditional replacement",
      "if (replaceProvider) React.useState = () => [0, () => consume(value)];",
    ],
    [
      "destructuring replacement",
      "({ setter: React.useState } = { setter: () => [0, () => consume(value)] });",
    ],
    ["loop replacement", "for (React.useState of [() => [0, () => consume(value)]]) {}"],
    [
      "a default-object alias",
      "const provider = React; provider.useState = () => [0, () => consume(value)];",
    ],
    [
      "a reflective getter",
      'Object.defineProperty(React, "useState", { get: () => () => [0, () => consume(value)] });',
    ],
    [
      "a legacy accessor",
      'React.__defineGetter__("useState", () => () => [0, () => consume(value)]);',
    ],
    ["provider escape", "replace(React, value);"],
    [
      "a direct CommonJS replacement",
      'require("react").useState = () => [0, () => consume(value)];',
    ],
    [
      "a CommonJS provider alias",
      'const provider = require("react"); provider.useState = () => [0, () => consume(value)];',
    ],
    [
      "a CommonJS accessor",
      'require("react").__defineGetter__("useState", () => () => [0, () => consume(value)]);',
    ],
    [
      "an unsupported readonly CommonJS caller",
      'const provider = require("react"); const element = provider.createElement("span");',
    ],
  ])("retains the callback dependency after %s", (_description, providerUse) => {
    const result = runCaller(providerUse);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("actions.increment");
  });

  it("checks a named default import of the provider", () => {
    const result = runCaller(
      "React.useState = () => [0, () => consume(value)];",
      'import { default as React, useEffect } from "react";',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("actions.increment");
  });

  it.each([
    ["a template module name", "require(`react`).useState = () => [0, () => consume(value)];"],
    [
      "an aliased global loader",
      'const loader = require; loader("react").useState = () => [0, () => consume(value)];',
    ],
    [
      "a global-object loader",
      'globalThis.require("react").useState = () => [0, () => consume(value)];',
    ],
  ])("declines a caller with %s", (_description, providerUse) => {
    const result = runCaller(providerUse);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("actions.increment");
  });

  it("accepts a shadowed global-object loader", () => {
    expect(
      runCaller(
        'const globalThis = { require: () => ({ version: "local" }) }; const metadata = globalThis.require("react");',
      ),
    ).toEqual({ diagnostics: [], parseErrors: [] });
  });
});
