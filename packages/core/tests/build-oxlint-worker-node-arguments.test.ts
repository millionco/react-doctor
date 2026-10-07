import { describe, expect, it } from "vite-plus/test";
import { buildOxlintWorkerNodeArguments } from "../src/utils/build-oxlint-worker-node-arguments.js";

describe("buildOxlintWorkerNodeArguments", () => {
  it("raises the TurboFan tier-up threshold on Node 22+", () => {
    expect(
      buildOxlintWorkerNodeArguments({ childNodeVersion: "v22.13.0", nativeThreadCount: 1 }),
    ).toEqual(["--max-old-space-size=4352", "--invocation-count-for-turbofan=30000"]);
    expect(
      buildOxlintWorkerNodeArguments({ childNodeVersion: "v24.0.0", nativeThreadCount: 1 }),
    ).toEqual(["--max-old-space-size=4352", "--invocation-count-for-turbofan=30000"]);
  });

  it("sizes the old-space ceiling to two oxlint transfer buffers per native thread", () => {
    expect(
      buildOxlintWorkerNodeArguments({ childNodeVersion: "v22.13.0", nativeThreadCount: 4 }),
    ).toEqual(["--max-old-space-size=17408", "--invocation-count-for-turbofan=30000"]);
  });

  it("skips the tiering flag on a Node 20 child, whose V8 rejects it", () => {
    expect(
      buildOxlintWorkerNodeArguments({ childNodeVersion: "v20.19.0", nativeThreadCount: 2 }),
    ).toEqual(["--max-old-space-size=8704"]);
  });

  it("skips the tiering flag when the child version is unknown", () => {
    expect(
      buildOxlintWorkerNodeArguments({
        childNodeVersion: "unknown:/opt/node/bin/node",
        nativeThreadCount: 1,
      }),
    ).toEqual(["--max-old-space-size=4352"]);
  });
});
