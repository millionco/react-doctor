import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

const SOURCE = `
  import { useCallback, useRef } from "react";

  const useLocalElement = (enabled: boolean) => {
    const element = useRef<HTMLDivElement | null>(null);
    return element;
  };

  export function Panel({ enabled, forwarded }) {
    const holder = useLocalElement(enabled);
    const attach = useCallback((node) => {
      holder.current = node;
      if (forwarded) forwarded.current = node;
    }, [forwarded]);
    return <div ref={attach} />;
  }
`;

const PACKAGE = { private: true, dependencies: { react: "19.2.3" } };

const lintProject = (source: string, projectFiles: Record<string, string> = {}) => {
  const directory = mkdtempSync(join(tmpdir(), "rd-local-hook-ref-"));
  try {
    const files = {
      "packages/panel/package.json": JSON.stringify(PACKAGE),
      ...projectFiles,
    };
    for (const [relativePath, content] of Object.entries(files)) {
      const filename = join(directory, relativePath);
      mkdirSync(dirname(filename), { recursive: true });
      writeFileSync(filename, content);
    }
    const filename = join(directory, "packages/panel/Panel.tsx");
    writeFileSync(filename, source);
    const result = runRule(exhaustiveDeps, source, { filename });
    expect(result.parseErrors).toEqual([]);
    return result.diagnostics;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

describe("returned refs from same-file hooks", () => {
  it("accepts a write through a returned useRef holder from stock React", () => {
    expect(lintProject(SOURCE)).toHaveLength(0);
  });

  it("keeps the warning for a different return value", () => {
    const alternative = SOURCE.replace(
      "return element;",
      "if (!enabled) return { current: null }; return element;",
    );
    expect(lintProject(alternative)).toHaveLength(1);
  });

  it("keeps an independent callback capture in the finding", () => {
    const mixed = SOURCE.replace(
      "{ enabled, forwarded }",
      "{ enabled, forwarded, onEdit }",
    ).replace("holder.current = node;", "holder.current = node; onEdit(node);");
    const diagnostics = lintProject(mixed);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("stale `onEdit`");
  });

  it.each([
    [
      "a Vite React alias",
      {
        "vite.config.ts": 'export default { resolve: { alias: { react: "./react-adapter.ts" } } };',
      },
    ],
    [
      "an ancestor workspace override",
      {
        "pnpm-workspace.yaml":
          'packages:\n  - "packages/*"\noverrides:\n  react: link:./react-adapter\n',
      },
    ],
    [
      "a browser entry for React",
      {
        "packages/panel/package.json": JSON.stringify({
          ...PACKAGE,
          browser: { react: "./react-adapter.js" },
        }),
      },
    ],
    [
      "an opaque Webpack configuration",
      {
        "webpack.config.js":
          'module.exports = { resolve: { alias: { react: "./react-adapter.js" } } };',
      },
    ],
  ])("keeps the warning for %s", (_description, files) => {
    expect(lintProject(SOURCE, files)).toHaveLength(1);
  });
});
