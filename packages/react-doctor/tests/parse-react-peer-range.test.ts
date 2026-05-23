import { describe, expect, it } from "vite-plus/test";
import { peerRangeMinMajor } from "@react-doctor/core";

describe("peerRangeMinMajor", () => {
  it("returns the lowest concrete major from OR ranges", () => {
    expect(peerRangeMinMajor("^17.0.0 || ^18.0.0 || ^19.0.0")).toBe(17);
    expect(peerRangeMinMajor("^18.0.0 || ^19.0.0")).toBe(18);
    expect(peerRangeMinMajor("^19.0.0")).toBe(19);
    expect(peerRangeMinMajor(">=17")).toBe(17);
    expect(peerRangeMinMajor(">=18 <20")).toBe(18);
    expect(peerRangeMinMajor("18 || 19")).toBe(18);
  });

  it("returns null for upper-bound-only ranges", () => {
    expect(peerRangeMinMajor("<19")).toBeNull();
    expect(peerRangeMinMajor("<=18")).toBeNull();
    expect(peerRangeMinMajor("< 19")).toBeNull();
  });

  it("returns null when any OR branch has only an upper bound", () => {
    expect(peerRangeMinMajor("<19 || ^19.0.0")).toBeNull();
    expect(peerRangeMinMajor("<=18 || ^19.0.0")).toBeNull();
    expect(peerRangeMinMajor("^19.0.0 || <19")).toBeNull();
    expect(peerRangeMinMajor("<20 || >=17")).toBeNull();
  });

  it("returns null for wildcards, tags, protocols, and missing input", () => {
    expect(peerRangeMinMajor("*")).toBeNull();
    expect(peerRangeMinMajor("latest")).toBeNull();
    expect(peerRangeMinMajor("workspace:*")).toBeNull();
    expect(peerRangeMinMajor("github:facebook/react#1234567890")).toBeNull();
    expect(peerRangeMinMajor("file:../react-19-local.tgz")).toBeNull();
    expect(peerRangeMinMajor("npm:@scope/react19-fork@latest")).toBeNull();
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

  it("returns null for non-lower-bound comparators", () => {
    expect(peerRangeMinMajor(">18")).toBeNull();
    expect(peerRangeMinMajor(">18 <20")).toBeNull();
    expect(peerRangeMinMajor("!=19")).toBeNull();
  });
});
