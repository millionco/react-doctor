import { describe, expect, it } from "vite-plus/test";
import { declaresDependency } from "./classify-package-platform.js";

describe("declaresDependency", () => {
  it.each(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])(
    "finds a dependency in %s",
    (sectionName) => {
      expect(
        declaresDependency(
          {
            [sectionName]: { next: "latest" },
          },
          "next",
        ),
      ).toBe(true);
    },
  );

  it("does not treat inherited or missing names as declarations", () => {
    const dependencies = Object.create({ next: "latest" });
    expect(declaresDependency({ dependencies }, "next")).toBe(false);
    expect(declaresDependency({ dependencies: { react: "latest" } }, "next")).toBe(false);
  });
});
