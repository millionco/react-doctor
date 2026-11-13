import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { isPathInsideDirectory } from "../src/utils/is-path-inside-directory.js";

describe("isPathInsideDirectory", () => {
  const rootDirectory = path.resolve("project");

  it.each(["..Preview.tsx", "..internal/component.tsx", "src/component.tsx"])(
    "accepts an in-tree path named %s",
    (relativePath) => {
      expect(isPathInsideDirectory(path.join(rootDirectory, relativePath), rootDirectory)).toBe(
        true,
      );
    },
  );

  it.each(["..", "../outside.tsx", "../project-sibling/component.tsx", "."])(
    "rejects %s as a descendant",
    (relativePath) => {
      expect(isPathInsideDirectory(path.join(rootDirectory, relativePath), rootDirectory)).toBe(
        false,
      );
    },
  );
});
