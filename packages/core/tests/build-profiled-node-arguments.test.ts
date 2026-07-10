import { describe, expect, it } from "vite-plus/test";
import { buildProfiledNodeArguments } from "../src/utils/build-profiled-node-arguments.js";

describe("buildProfiledNodeArguments", () => {
  it("passes child arguments through when profiling is disabled", () => {
    expect(
      buildProfiledNodeArguments({
        argumentsList: ["oxlint.js", "--format", "json"],
        cpuProfileDirectory: undefined,
        heapProfileDirectory: undefined,
      }),
    ).toEqual(["oxlint.js", "--format", "json"]);
  });

  it("enables V8 CPU and heap profiles when directories are provided", () => {
    expect(
      buildProfiledNodeArguments({
        argumentsList: ["oxlint.js", "--format", "json"],
        cpuProfileDirectory: "/tmp/react-doctor-profiles",
        heapProfileDirectory: "/tmp/react-doctor-profiles",
      }),
    ).toEqual([
      "--cpu-prof",
      "--cpu-prof-dir=/tmp/react-doctor-profiles",
      "--heap-prof",
      "--heap-prof-dir=/tmp/react-doctor-profiles",
      "oxlint.js",
      "--format",
      "json",
    ]);
  });
});
