import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { clearConfigCache, loadConfigWithSource } from "../src/load-config.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  clearConfigCache();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const createProject = (files: Readonly<Record<string, string>>): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-load-config-"));
  temporaryDirectories.push(directory);
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(directory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return fs.realpathSync(directory);
};

describe("loadConfigWithSource", () => {
  it("does not fall through to a parent config after a malformed ancestor config", async () => {
    const directory = createProject({
      "doctor.config.json": JSON.stringify({ lint: false }),
      "packages/ui/doctor.config.json": "{",
      "packages/ui/src/index.tsx": "export const App = () => null;",
    });

    const loaded = await loadConfigWithSource(path.join(directory, "packages/ui/src"));

    expect(loaded).toBeNull();
  });
});
