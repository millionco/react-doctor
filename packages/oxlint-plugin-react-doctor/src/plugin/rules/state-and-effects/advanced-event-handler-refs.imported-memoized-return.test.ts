import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { advancedEventHandlerRefs } from "./advanced-event-handler-refs.js";

const stableProvider = `
  import { useState, useCallback } from "react";
  export const useSelection = () => {
    const [active, setActive] = useState(false);
    const commit = useCallback(() => setActive(false), []);
    return { active, commit };
  };
`;

const runFixture = (
  provider: string,
  {
    importClause = 'import { useSelection } from "~/selection";',
    otherListener = false,
    remapReact = false,
    reactImport = 'import { useEffect } from "react";',
    callArguments = "",
  } = {},
) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-imported-memoized-handler-"));
  try {
    fs.mkdirSync(path.join(directory, "src"));
    fs.writeFileSync(
      path.join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          paths: { "~/*": ["./src/*"], ...(remapReact ? { react: ["./src/fake-react.ts"] } : {}) },
        },
      }),
    );
    fs.writeFileSync(path.join(directory, "src/selection.ts"), provider);
    if (remapReact) {
      fs.writeFileSync(
        path.join(directory, "src/fake-react.ts"),
        "export const useCallback = (callback) => () => callback();",
      );
    }
    const filename = path.join(directory, "src/view.tsx");
    const consumer = `
      ${reactImport}
      ${importClause}
      export const View = ({ enabled, onMove }) => {
        const { active, commit: onCommit } = useSelection(${callArguments});
        useEffect(() => {
          if (!enabled) return;
          window.addEventListener("pointerup", onCommit);
          ${otherListener ? 'window.addEventListener("pointermove", onMove);' : ""}
          return () => {
            window.removeEventListener("pointerup", onCommit);
            ${otherListener ? 'window.removeEventListener("pointermove", onMove);' : ""}
          };
        }, [enabled, onCommit${otherListener ? ", onMove" : ""}]);
        return <output>{active}</output>;
      };
    `;
    fs.writeFileSync(filename, consumer);
    return runRule(advancedEventHandlerRefs, consumer, { filename });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

describe("advanced-event-handler-refs — imported memoized return field", () => {
  it("keeps a resolved own field quiet even when the Hook returns other fields", () => {
    const result = runFixture(stableProvider);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports a different registered handler that can change", () => {
    const result = runFixture(stableProvider, { otherListener: true });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain('"onMove"');
  });

  it("allows a React facade used only in erased type positions", () => {
    const result = runFixture(stableProvider, {
      reactImport: `import React, { useEffect } from "react";
        type Gesture = React.ChangeEvent<HTMLInputElement>;`,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("retains the warning when a React facade is used at runtime", () => {
    const result = runFixture(stableProvider, {
      reactImport: `import React, { useEffect } from "react"; opaque(React);`,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("retains the warning when an equivalent named default facade escapes", () => {
    const result = runFixture(stableProvider, {
      reactImport: `import { default as React, useEffect } from "react"; opaque(React);`,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts ordinary Hook arguments without treating them as callback dependencies", () => {
    const result = runFixture(stableProvider.replace("() => {", "(first, second, third) => {"), {
      callArguments: "enabled, onMove, measure()",
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("declines spread Hook arguments", () => {
    const result = runFixture(stableProvider, { callArguments: "...input" });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    stableProvider.replace("() => {", "(first = read()) => {"),
    stableProvider.replace(
      "useCallback(() => setActive(false), [])",
      "(() => useCallback(() => setActive(false), []))()",
    ),
    stableProvider.replace(
      "export const useSelection",
      "const load = globalThis.process.getBuiltinModule; export const useSelection",
    ),
    stableProvider.replace("setActive(false), []", "setActive(false), [active]"),
    stableProvider.replace(
      "return { active, commit };",
      "return { active, commit: () => commit() };",
    ),
    stableProvider.replace(
      "return { active, commit };",
      "return { active, get commit() { return commit; } };",
    ),
    stableProvider.replace(
      "return { active, commit };",
      "return { active, commit, ...overrides };",
    ),
    stableProvider.replace(
      "return { active, commit };",
      "return { active, commit, commit: () => {} };",
    ),
    stableProvider.replace(
      "return { active, commit };",
      "if (active) return { commit: () => {} }; return { active, commit };",
    ),
    stableProvider.replace("export const useSelection", "export let useSelection"),
    stableProvider.replace(
      'import { useState, useCallback } from "react";',
      'import React, { useState, useCallback } from "react"; React.useCallback = fake;',
    ),
    stableProvider.replace(
      'import { useState, useCallback } from "react";',
      'import { useState, type useCallback } from "react";',
    ),
  ])("retains the diagnostic without a closed stable field: %s", (provider) => {
    const result = runFixture(provider);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain('"onCommit"');
  });

  it("retains the warning for a known React remap", () => {
    expect(runFixture(stableProvider, { remapReact: true }).diagnostics).toHaveLength(1);
  });

  it("retains the warning for an unresolved provider or type-only consumer", () => {
    const missing = runFixture(stableProvider, {
      importClause: 'import { useSelection } from "~/missing";',
    });
    const typeOnly = runFixture(stableProvider, {
      importClause: 'import { type useSelection } from "~/selection";',
    });

    expect(missing.diagnostics).toHaveLength(1);
    expect(typeOnly.diagnostics).toHaveLength(1);
  });
});
