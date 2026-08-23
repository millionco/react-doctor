import * as fs from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { NATIVE_REACT_DOCTOR_RULE_IDS } from "../src/constants.js";

const upstreamRegistryPath = new URL("../../../native/oxlint/upstream.json", import.meta.url);

describe("native React Doctor rule registry", () => {
  it("keeps the production allowlist synchronized with the Rust registry", () => {
    const upstreamRegistry = JSON.parse(fs.readFileSync(upstreamRegistryPath, "utf8"));

    expect([...NATIVE_REACT_DOCTOR_RULE_IDS]).toEqual(upstreamRegistry.nativeRules);
  });
});
