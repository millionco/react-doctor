import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";
import { inspect } from "../src/inspect.js";
import { runExplain } from "../src/cli/utils/run-explain.js";
import { setupReactProject } from "./regressions/_helpers.js";

vi.mock("ora", () => ({
  default: () => ({
    text: "",
    start: function () {
      return this;
    },
    stop: function () {
      return this;
    },
    succeed: () => {},
    fail: () => {},
  }),
}));

// The babel code frame is syntax-highlighted, so strip its SGR color
// escapes (ESC [ ... m) before asserting on the plain structural layout.
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (text: string): string => text.replace(ANSI_ESCAPE_PATTERN, "");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-run-explain-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("runExplain", () => {
  // Regression: `buildCodeFrame` was wired into the scan summary but never
  // into the single-location `why` path, so explaining a diagnostic showed
  // the rule + help but not the offending source. Prove the frame renders.
  it("renders a source code frame for the explained diagnostic", async () => {
    const projectDirectory = setupReactProject(tempRoot, "with-issue", {
      files: {
        "src/item-list.tsx": [
          "export const ItemList = ({ items }: { items: string[] }) => (",
          "  <ul>",
          "    {items.map((item, index) => (",
          "      <li key={index}>{item}</li>",
          "    ))}",
          "  </ul>",
          ");",
          "",
        ].join("\n"),
      },
    });

    const scanResult = await inspect(projectDirectory, {
      lint: true,
      deadCode: false,
      silent: true,
      noScore: true,
    });
    expect(scanResult.diagnostics.length).toBeGreaterThan(0);

    const target = scanResult.diagnostics[0]!;
    const relativeFilePath = path.relative(
      projectDirectory,
      path.resolve(projectDirectory, target.filePath),
    );
    const sourceLines = fs
      .readFileSync(path.join(projectDirectory, relativeFilePath), "utf8")
      .split("\n");
    const offendingLine = sourceLines[target.line - 1] ?? "";

    const loggedLines: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      loggedLines.push(args.join(" "));
    });
    try {
      await runExplain(`${relativeFilePath}:${target.line}`, {
        resolvedDirectory: projectDirectory,
        userConfig: null,
        scanOptions: { lint: true, deadCode: false },
        projectFlag: undefined,
      });
    } finally {
      consoleSpy.mockRestore();
    }

    const output = stripAnsi(loggedLines.join("\n"));
    // The headline (existing behavior) plus the babel code frame (the fix):
    // the `>` gutter marks the offending line and its source text is shown.
    expect(output).toContain(`${target.plugin}/${target.rule}`);
    expect(output).toContain(`> ${target.line} |`);
    expect(output).toContain(offendingLine.trim());
  });
});
