import { describe, expect, it } from "vite-plus/test";
import { REACT_DOCTOR_PLUGIN_RESET_HOOK_KEY } from "./constants/host.js";
import plugin from "./react-doctor-plugin.js";
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
});
