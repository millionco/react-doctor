import { describe, expect, it } from "vite-plus/test";
import { readClosedJsonSnapshotYarnResolution } from "./read-closed-json-snapshot-yarn-resolution.js";

const lockText = `# yarn lockfile v1
"react@^16.0.0":
  version "16.14.0"
  resolved "https://registry.yarnpkg.com/react/-/react-16.14.0.tgz#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  dependencies:
    object-assign "^4.1.1"
  optionalDependencies:
    optional-peer "^1.0.0"
`;

describe("selected Yarn source resolution extraction", () => {
  it("preserves prior generic single-selector version extraction without claiming its dependency graph", () => {
    const result = readClosedJsonSnapshotYarnResolution({
      lockText,
      packageName: "react",
      declaration: "^16.0.0",
    });
    expect(result?.version).toBe("16.14.0");
    expect(result?.dependencies.size).toBe(0);
  });
  it("keeps generic grouped-selector refusal unchanged", () => {
    expect(
      readClosedJsonSnapshotYarnResolution({
        lockText: lockText.replace('"react@^16.0.0":', '"react@^16.0.0", "react@^16.1.0":'),
        packageName: "react",
        declaration: "^16.0.0",
      }),
    ).toBeNull();
  });
  it("does not use unsupported optional dependency maps as strict SDK graph proof", () => {
    expect(
      readClosedJsonSnapshotYarnResolution({
        lockText,
        packageName: "react",
        declaration: "^16.0.0",
        allowGroupedSelectors: true,
        satisfiesDeclaration: () => true,
      }),
    ).toBeNull();
  });
});
