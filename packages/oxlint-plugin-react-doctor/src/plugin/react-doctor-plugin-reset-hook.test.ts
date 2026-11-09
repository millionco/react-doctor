import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { REACT_DOCTOR_PLUGIN_RESET_HOOK_KEY } from "./constants/host.js";
import plugin from "./react-doctor-plugin.js";
import { isExhaustiveDepsSuppressedAt } from "./rules/react-builtins/exhaustive-deps-suppression.js";
import { isRulesOfHooksSuppressedAt } from "./rules/react-builtins/rules-of-hooks-suppression.js";
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

  it("clears React Hooks suppression caches for warm plugin hosts", () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-reset-hook-"));
    try {
      const filePath = path.join(tempDirectory, "component.tsx");
      const suppressedSource =
        "/* eslint-disable-next-line react-hooks/rules-of-hooks, react-hooks/exhaustive-deps */\nuseEffect(() => {}, []);\n";
      const hookOffset = suppressedSource.indexOf("useEffect");
      fs.writeFileSync(filePath, suppressedSource);

      expect(isRulesOfHooksSuppressedAt(filePath, hookOffset)).toBe(true);
      expect(isExhaustiveDepsSuppressedAt(filePath, hookOffset)).toBe(true);

      fs.writeFileSync(filePath, "useEffect(() => {}, []);\n");
      resetFilesystemCaches();

      expect(isRulesOfHooksSuppressedAt(filePath, 0)).toBe(false);
      expect(isExhaustiveDepsSuppressedAt(filePath, 0)).toBe(false);
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});
