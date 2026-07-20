import { describe, expect, it } from "vite-plus/test";
import { getPreferredDependencyVersion } from "../src/project-info/get-preferred-dependency-version.js";

describe("getPreferredDependencyVersion", () => {
  it("prefers runtime dependencies over peer and development declarations", () => {
    const version = getPreferredDependencyVersion({
      packageJson: {
        dependencies: { library: "3" },
        peerDependencies: { library: "2" },
        devDependencies: { library: "1" },
      },
      packageNames: ["library"],
    });

    expect(version).toBe("3");
  });

  it("prefers package order before dependency section order", () => {
    const version = getPreferredDependencyVersion({
      packageJson: {
        dependencies: { fallback: "3" },
        devDependencies: { preferred: "1" },
      },
      packageNames: ["preferred", "fallback"],
    });

    expect(version).toBe("1");
  });

  it("falls back through package names", () => {
    const version = getPreferredDependencyVersion({
      packageJson: { peerDependencies: { fallback: "2" } },
      packageNames: ["preferred", "fallback"],
    });

    expect(version).toBe("2");
  });

  it("returns null when no preferred package is declared", () => {
    const version = getPreferredDependencyVersion({
      packageJson: { optionalDependencies: { library: "4" } },
      packageNames: ["library"],
    });

    expect(version).toBeNull();
  });

  it("ignores malformed non-string dependency versions", () => {
    const version = getPreferredDependencyVersion({
      packageJson: JSON.parse('{"dependencies":{"library":6}}'),
      packageNames: ["library"],
    });

    expect(version).toBeNull();
  });
});
