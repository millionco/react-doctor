import { describe, expect, it } from "vite-plus/test";
import {
  compareConcreteSemver,
  formatConcreteSemver,
  parseConcreteSemver,
} from "@react-doctor/core";

describe("parseConcreteSemver", () => {
  it("parses a bare concrete version", () => {
    expect(parseConcreteSemver("19.2.0")).toEqual({
      major: 19,
      minor: 2,
      patch: 0,
      isPrerelease: false,
    });
  });

  it("tolerates a leading `v`", () => {
    expect(parseConcreteSemver("v15.5.18")).toEqual({
      major: 15,
      minor: 5,
      patch: 18,
      isPrerelease: false,
    });
  });

  it("marks prerelease versions", () => {
    expect(parseConcreteSemver("19.2.0-canary.77")).toEqual({
      major: 19,
      minor: 2,
      patch: 0,
      isPrerelease: true,
    });
  });

  it("treats build metadata (after `+`) as a release, not a prerelease", () => {
    expect(parseConcreteSemver("19.2.6+build.1")?.isPrerelease).toBe(false);
  });

  it("rejects range specs so an ambiguous range never resolves to a version", () => {
    for (const range of ["^19.2.0", "~19.0.1", ">=19.1.2", "<19.2.1", "19.x", "19", "19.2", "*"]) {
      expect(parseConcreteSemver(range)).toBeNull();
    }
  });

  it("rejects dist-tags, protocols, and non-strings", () => {
    expect(parseConcreteSemver("latest")).toBeNull();
    expect(parseConcreteSemver("catalog:")).toBeNull();
    expect(parseConcreteSemver("workspace:*")).toBeNull();
    expect(parseConcreteSemver(null)).toBeNull();
    expect(parseConcreteSemver(undefined)).toBeNull();
    expect(parseConcreteSemver("")).toBeNull();
  });
});

describe("compareConcreteSemver", () => {
  const parse = (version: string) => {
    const parsed = parseConcreteSemver(version);
    if (parsed === null) throw new Error(`unparseable test version: ${version}`);
    return parsed;
  };

  it("orders by major, then minor, then patch", () => {
    expect(compareConcreteSemver(parse("19.2.0"), parse("19.2.1"))).toBeLessThan(0);
    expect(compareConcreteSemver(parse("19.2.6"), parse("19.2.1"))).toBeGreaterThan(0);
    expect(compareConcreteSemver(parse("19.1.9"), parse("19.2.0"))).toBeLessThan(0);
    expect(compareConcreteSemver(parse("19.2.1"), parse("19.2.1"))).toBe(0);
  });

  it("sorts a prerelease below the release that shares its core", () => {
    expect(compareConcreteSemver(parse("19.2.6-rc.1"), parse("19.2.6"))).toBeLessThan(0);
    expect(compareConcreteSemver(parse("16.0.0-canary"), parse("16.0.7"))).toBeLessThan(0);
  });
});

describe("formatConcreteSemver", () => {
  it("renders the core version", () => {
    expect(formatConcreteSemver(parseConcreteSemver("19.2.0")!)).toBe("19.2.0");
  });

  it("annotates prereleases", () => {
    expect(formatConcreteSemver(parseConcreteSemver("19.2.0-canary")!)).toBe("19.2.0-prerelease");
  });
});
