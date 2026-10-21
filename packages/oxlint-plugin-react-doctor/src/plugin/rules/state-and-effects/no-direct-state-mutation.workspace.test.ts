import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { noDirectStateMutation } from "./no-direct-state-mutation.js";
import fixtures from "./no-direct-state-mutation.workspace-fixtures.json";

let workspace: string;

beforeEach(() => {
  workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workspace-ref-relay-")));
  resetFilesystemCaches();
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe("workspace callback ref visibility writes", () => {
  for (const fixture of fixtures.cases) {
    it(fixture.name, () => {
      const files = { ...fixtures.baseFiles, ...fixture.updates };
      for (const [relativePath, contents] of Object.entries(files)) {
        const filename = path.join(workspace, relativePath);
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        fs.writeFileSync(filename, contents);
      }
      if (fixture.symlinkProvider) {
        const provider = path.join(workspace, "packages/ref-kit");
        const outside = path.join(workspace, "external-provider");
        fs.renameSync(provider, outside);
        fs.symlinkSync(outside, provider, "dir");
      }
      const filename = path.join(workspace, "packages/ui/src/panel.tsx");
      const source = fs.readFileSync(filename, "utf8");
      let rootDirectory: string | undefined;
      if (fixture.settingsRoot === "CONSUMER_ROOT")
        rootDirectory = path.join(workspace, "packages/ui");
      else if (fixture.settingsRoot === "WORKSPACE_ROOT") rootDirectory = workspace;
      const result = runRule(noDirectStateMutation, source, {
        filename,
        includeLocations: true,
        settings: { "react-doctor": { rootDirectory } },
      });
      const mutation = fixture.expectedMutation;
      const prefix = mutation ? source.slice(0, source.indexOf(mutation)) : "";
      const lines = prefix.split("\n");
      expect(result).toEqual({
        parseErrors: [],
        diagnostics: mutation
          ? [
              {
                nodeType: "AssignmentExpression",
                line: lines.length,
                column: lines[lines.length - 1].length,
                message:
                  'React can\'t tell you changed "node" in place, so this update can be skipped or lost.',
              },
            ]
          : [],
      });
    });
  }
});
