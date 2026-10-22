import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { REACT_DOCTOR_PLUGIN_RESET_HOOK_KEY } from "./constants/host.js";
import plugin from "./react-doctor-plugin.js";
import { parseSourceFile } from "./utils/parse-source-file.js";
import { resetFilesystemCaches } from "./utils/reset-filesystem-caches.js";

describe("react-doctor plugin filesystem-cache reset hook", () => {
  it("publishes resetFilesystemCaches for hosts that keep the plugin warm across jobs", () => {
    expect(plugin.meta.name).toBe("react-doctor");
    expect(Reflect.get(globalThis, REACT_DOCTOR_PLUGIN_RESET_HOOK_KEY)).toBe(resetFilesystemCaches);
  });

  it("uses the same registry key as @react-doctor/core's worker", () => {
    expect(REACT_DOCTOR_PLUGIN_RESET_HOOK_KEY).toBe(
      Symbol.for("react-doctor.reset-filesystem-caches"),
    );
  });

  it("refreshes same-size cross-file source after the filesystem epoch reset", () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-parse-epoch-"));
    const providerPath = path.join(temporaryDirectory, "provider.ts");
    const preservedTimestamp = new Date("2025-01-01T00:00:00.000Z");
    try {
      fs.writeFileSync(providerPath, '"string";');
      fs.utimesSync(providerPath, preservedTimestamp, preservedTimestamp);
      expect(parseSourceFile(providerPath)).toMatchObject({
        type: "Program",
        body: [{ type: "ExpressionStatement", expression: { type: "Literal", value: "string" } }],
      });

      fs.writeFileSync(providerPath, '"number";');
      fs.utimesSync(providerPath, preservedTimestamp, preservedTimestamp);
      expect(fs.statSync(providerPath).mtimeMs).toBe(preservedTimestamp.getTime());
      expect(fs.statSync(providerPath).size).toBe(Buffer.byteLength('"string";'));
      resetFilesystemCaches();
      expect(parseSourceFile(providerPath)).toMatchObject({
        type: "Program",
        body: [{ type: "ExpressionStatement", expression: { type: "Literal", value: "number" } }],
      });
    } finally {
      resetFilesystemCaches();
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
