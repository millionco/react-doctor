import { describe, expect, it } from "vite-plus/test";
import { peerRangeMinMajor } from "../src/core/parse-react-peer-range.js";

describe("peerRangeMinMajor", () => {
  it("returns the lowest concrete major from OR ranges", () => {
    expect(peerRangeMinMajor("^17.0.0 || ^18.0.0 || ^19.0.0")).toBe(17);
    expect(peerRangeMinMajor("^18.0.0 || ^19.0.0")).toBe(18);
    expect(peerRangeMinMajor("^19.0.0")).toBe(19);
    expect(peerRangeMinMajor(">=17")).toBe(17);
    expect(peerRangeMinMajor("18 || 19")).toBe(18);
  });

  it("returns null for wildcards, tags, and missing input", () => {
    expect(peerRangeMinMajor("*")).toBeNull();
    expect(peerRangeMinMajor("latest")).toBeNull();
    expect(peerRangeMinMajor("workspace:*")).toBeNull();
    expect(peerRangeMinMajor(null)).toBeNull();
    expect(peerRangeMinMajor(undefined)).toBeNull();
    expect(peerRangeMinMajor("")).toBeNull();
  });

  it("ignores 0.x experimental versions", () => {
    expect(peerRangeMinMajor("0.0.0-experimental")).toBeNull();
    expect(peerRangeMinMajor("0.0.0-canary-1a2b3c4d")).toBeNull();
  });

  it("handles single-version specs", () => {
    expect(peerRangeMinMajor("19")).toBe(19);
    expect(peerRangeMinMajor("~19.0.0")).toBe(19);
    expect(peerRangeMinMajor("^19.0.0")).toBe(19);
  });
});
