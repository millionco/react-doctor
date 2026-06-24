import { describe, expect, it } from "vite-plus/test";
import { classifyVersionSpec } from "../../../scripts/resolve-package-spec.mjs";

// The action keys its install cache on the resolved react-doctor version, so the
// version→spec classification (cacheable registry range vs non-cacheable local
// path) is load-bearing for the cache being sound. Lock the branch logic.
describe("classifyVersionSpec", () => {
  it("treats `latest` as a cacheable registry range", () => {
    expect(classifyVersionSpec("latest")).toEqual({
      cacheable: true,
      spec: "react-doctor@latest",
      registryRange: "latest",
    });
  });

  it("treats an exact version as a cacheable registry spec", () => {
    expect(classifyVersionSpec("2.1.0")).toEqual({
      cacheable: true,
      spec: "react-doctor@2.1.0",
      registryRange: "2.1.0",
    });
  });

  it("treats a semver range as cacheable", () => {
    expect(classifyVersionSpec("^2")).toEqual({
      cacheable: true,
      spec: "react-doctor@^2",
      registryRange: "^2",
    });
  });

  it("treats a relative local path as a NON-cacheable passthrough spec (self-test path)", () => {
    expect(classifyVersionSpec("./packages/react-doctor")).toEqual({
      cacheable: false,
      spec: "./packages/react-doctor",
      registryRange: undefined,
    });
    expect(classifyVersionSpec("../foo")).toEqual({
      cacheable: false,
      spec: "../foo",
      registryRange: undefined,
    });
  });

  it("treats an absolute local path as non-cacheable", () => {
    expect(classifyVersionSpec("/tmp/react-doctor")).toEqual({
      cacheable: false,
      spec: "/tmp/react-doctor",
      registryRange: undefined,
    });
  });

  it("defaults an empty / undefined version to `latest`", () => {
    const expected = { cacheable: true, spec: "react-doctor@latest", registryRange: "latest" };
    expect(classifyVersionSpec("")).toEqual(expected);
    expect(classifyVersionSpec(undefined)).toEqual(expected);
  });

  it("trims surrounding whitespace", () => {
    expect(classifyVersionSpec("  latest  ")).toEqual({
      cacheable: true,
      spec: "react-doctor@latest",
      registryRange: "latest",
    });
  });
});
