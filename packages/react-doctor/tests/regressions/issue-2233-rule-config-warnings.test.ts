import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { setupReactProject, writeJson } from "./_helpers.js";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-2233-"));
const cli = path.resolve(import.meta.dirname, "../../bin/react-doctor.js");
afterAll(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

describe("unknown rule warnings reach config consumers", () => {
  it.each(["scan", "catalog"])("warns on stderr without corrupting %s output", (command) => {
    const directory = setupReactProject(temporaryDirectory, command, {
      files: { "src/App.tsx": "export const App = () => null;" },
    });
    writeJson(path.join(directory, "doctor.config.json"), {
      rules: { "react-doctor/no-fetch-in-efect": "error" },
    });
    const args =
      command === "scan"
        ? [directory, "--json", "--no-score", "--no-supply-chain", "--no-dead-code", "--yes"]
        : ["rules", "list", "--configured"];
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, REACT_DOCTOR_NO_TELEMETRY: "1", REACT_DOCTOR_NO_UPDATE_NOTIFIER: "1" },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("rules.react-doctor/no-fetch-in-efect");
    expect(result.stderr).toContain("rules list");
    if (command === "scan") expect(JSON.parse(result.stdout).schemaVersion).toBe(3);
  });
});
