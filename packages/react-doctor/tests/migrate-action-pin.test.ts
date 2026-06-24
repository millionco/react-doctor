import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { migrateActionPin } from "../src/cli/utils/migrate-action-pin.js";

let projectRoot: string;
let workflowsDir: string;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-action-pin-"));
  workflowsDir = path.join(projectRoot, ".github", "workflows");
  fs.mkdirSync(workflowsDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

const writeWorkflow = (name: string, contents: string): string => {
  const workflowPath = path.join(workflowsDir, name);
  fs.writeFileSync(workflowPath, contents);
  return workflowPath;
};

describe("migrateActionPin", () => {
  it("rewrites a mutable @main action ref to @v2, preserving owner + the rest of the line", () => {
    const workflowPath = writeWorkflow(
      "ci.yml",
      ["jobs:", "  scan:", "    steps:", "      - uses: millionco/react-doctor@main", ""].join(
        "\n",
      ),
    );
    const rewritten = migrateActionPin(projectRoot);
    expect(rewritten).toEqual([workflowPath]);
    expect(fs.readFileSync(workflowPath, "utf-8")).toContain("- uses: millionco/react-doctor@v2");
  });

  it("rewrites @master too", () => {
    const workflowPath = writeWorkflow("ci.yaml", "      - uses: millionco/react-doctor@master\n");
    migrateActionPin(projectRoot);
    expect(fs.readFileSync(workflowPath, "utf-8").trim()).toBe("- uses: millionco/react-doctor@v2");
  });

  it("preserves the action's `version:` input + a trailing comment, touching only the ref", () => {
    const workflowPath = writeWorkflow(
      "ci.yml",
      [
        "      - uses: millionco/react-doctor@main # latest",
        "        with:",
        "          version: latest",
        "",
      ].join("\n"),
    );
    migrateActionPin(projectRoot);
    const contents = fs.readFileSync(workflowPath, "utf-8");
    expect(contents).toContain("- uses: millionco/react-doctor@v2 # latest");
    expect(contents).toContain("version: latest"); // the CLI version input is untouched
  });

  it("leaves a deliberately pinned tag or SHA untouched", () => {
    const pinned = [
      "      - uses: millionco/react-doctor@v2.1.0",
      "      - uses: millionco/react-doctor@a1b2c3d4e5f6 # v2.1.0",
    ].join("\n");
    writeWorkflow("pinned.yml", pinned);
    expect(migrateActionPin(projectRoot)).toEqual([]);
  });

  it("leaves a different action on @main untouched", () => {
    const other = "      - uses: actions/checkout@main\n";
    const workflowPath = writeWorkflow("other.yml", other);
    expect(migrateActionPin(projectRoot)).toEqual([]);
    expect(fs.readFileSync(workflowPath, "utf-8")).toBe(other);
  });

  it("is a no-op (returns []) when there is no .github/workflows directory", () => {
    fs.rmSync(path.join(projectRoot, ".github"), { recursive: true, force: true });
    expect(migrateActionPin(projectRoot)).toEqual([]);
  });

  it("rewrites across multiple workflow files and reports each", () => {
    const first = writeWorkflow("a.yml", "      - uses: millionco/react-doctor@main\n");
    const second = writeWorkflow("b.yml", "      - uses: millionco/react-doctor@master\n");
    writeWorkflow("c.yml", "      - uses: millionco/react-doctor@v2\n"); // already pinned
    expect(migrateActionPin(projectRoot).sort()).toEqual([first, second].sort());
  });
});
