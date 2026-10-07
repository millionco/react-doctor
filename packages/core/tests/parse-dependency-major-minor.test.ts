import { describe, expect, it } from "vite-plus/test";
import { parseDependencyMajorMinor } from "@react-doctor/core";

describe("parseDependencyMajorMinor", () => {
  it("parses semver ranges and npm alias target versions", () => {
    expect(parseDependencyMajorMinor("^6.10.0")).toEqual({ major: 6, minor: 10 });
    expect(parseDependencyMajorMinor("npm:mobx-v5@^6.10.0")).toEqual({ major: 6, minor: 10 });
  });

  it("does not infer versions from unresolved source references", () => {
    expect(parseDependencyMajorMinor("catalog:mobx6")).toBeNull();
    expect(parseDependencyMajorMinor("workspace:~6.10.0")).toBeNull();
    expect(parseDependencyMajorMinor("git+https://github.com/acme/mobx.git#v6.10.0")).toBeNull();
    expect(parseDependencyMajorMinor("acme/mobx#v6.10.0")).toBeNull();
  });
});
