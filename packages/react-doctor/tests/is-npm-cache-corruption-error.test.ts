import { describe, expect, it } from "vite-plus/test";
import {
  formatNpmCacheCorruptionError,
  isNpmCacheCorruptionError,
} from "../src/cli/utils/is-npm-cache-corruption-error.js";

interface ModuleNotFoundError extends Error {
  code: string;
  requireStack?: string[];
}

const moduleNotFoundError = (
  message: string,
  requireStack: string[] = [],
): ModuleNotFoundError =>
  Object.assign(new Error(message), {
    code: "MODULE_NOT_FOUND",
    requireStack,
  });

describe("isNpmCacheCorruptionError", () => {
  it("recognizes ajv missing module errors in npx cache", () => {
    const error = moduleNotFoundError(
      "Cannot find module './meta/unevaluated.json'",
      [
        "/home/user/.npm/_npx/81e833f6d16d6127/node_modules/ajv/dist/refs/json-schema-2020-12/index.js",
        "/home/user/.npm/_npx/81e833f6d16d6127/node_modules/ajv/dist/2020.js",
      ],
    );
    expect(isNpmCacheCorruptionError(error)).toBe(true);
  });

  it("recognizes conf-related module errors in npx cache", () => {
    const error = moduleNotFoundError(
      "Cannot find module 'ajv-formats'",
      [
        "/home/user/.npm/_npx/abc123/node_modules/conf/dist/index.js",
      ],
    );
    expect(isNpmCacheCorruptionError(error)).toBe(true);
  });

  it("recognizes npx cache errors on Windows", () => {
    const error = moduleNotFoundError(
      "Cannot find module './meta/validation.json'",
      [
        "C:\\Users\\user\\AppData\\Local\\npm-cache\\_npx\\abc123\\node_modules\\ajv\\dist\\2020.js",
      ],
    );
    expect(isNpmCacheCorruptionError(error)).toBe(true);
  });

  it("recognizes errors with _npx path in the message", () => {
    const error = moduleNotFoundError(
      "Cannot find module '/home/user/.npm/_npx/abc/node_modules/ajv/dist/meta/unevaluated.json'",
    );
    expect(isNpmCacheCorruptionError(error)).toBe(true);
  });

  it("does NOT recognize regular MODULE_NOT_FOUND errors", () => {
    const error = moduleNotFoundError(
      "Cannot find module './missing-file.js'",
      ["/home/user/project/src/index.js"],
    );
    expect(isNpmCacheCorruptionError(error)).toBe(false);
  });

  it("does NOT recognize non-npx cache ajv errors", () => {
    const error = moduleNotFoundError(
      "Cannot find module 'ajv'",
      ["/home/user/project/node_modules/some-package/index.js"],
    );
    expect(isNpmCacheCorruptionError(error)).toBe(false);
  });

  it("does NOT recognize npx cache errors for unrelated packages", () => {
    const error = moduleNotFoundError(
      "Cannot find module 'some-other-package'",
      ["/home/user/.npm/_npx/abc123/node_modules/some-other-package/index.js"],
    );
    expect(isNpmCacheCorruptionError(error)).toBe(false);
  });

  it("returns false for non-Error and non-MODULE_NOT_FOUND values", () => {
    expect(isNpmCacheCorruptionError(new Error("Something went wrong"))).toBe(false);
    expect(isNpmCacheCorruptionError("string error")).toBe(false);
    expect(isNpmCacheCorruptionError(null)).toBe(false);
    expect(isNpmCacheCorruptionError(undefined)).toBe(false);
  });

  it("handles errors wrapped in cause chains", () => {
    const innerError = moduleNotFoundError(
      "Cannot find module './meta/unevaluated.json'",
      ["/home/user/.npm/_npx/abc/node_modules/ajv/dist/2020.js"],
    );
    const outerError = new Error("Failed to initialize", { cause: innerError });
    expect(isNpmCacheCorruptionError(outerError)).toBe(true);
  });
});

describe("formatNpmCacheCorruptionError", () => {
  it("formats npm cache corruption errors with clear instructions", () => {
    const error = moduleNotFoundError(
      "Cannot find module './meta/unevaluated.json'",
      ["/home/user/.npm/_npx/abc/node_modules/ajv/dist/2020.js"],
    );

    const formatted = formatNpmCacheCorruptionError(error);

    expect(formatted).toContain("npx cache has an incomplete installation");
    expect(formatted).toContain("npm 12 + Node 26");
    expect(formatted).toContain("npm cache clean --force");
    expect(formatted).toContain("bunx react-doctor@latest");
    expect(formatted).toContain("pnpm dlx react-doctor@latest");
    expect(formatted).toContain("Cannot find module './meta/unevaluated.json'");
  });

  it("includes platform-specific cache clear command", () => {
    const error = moduleNotFoundError(
      "Cannot find module './meta/unevaluated.json'",
      ["/home/user/.npm/_npx/abc/node_modules/ajv/dist/2020.js"],
    );

    const formatted = formatNpmCacheCorruptionError(error);

    if (process.platform === "win32") {
      expect(formatted).toContain('rd /s /q "%LOCALAPPDATA%\\npm-cache\\_npx"');
    } else {
      expect(formatted).toContain("rm -rf ~/.npm/_npx");
    }
  });

  it("falls back to the raw message for non-npm-cache errors", () => {
    const error = new Error("Some other error");
    expect(formatNpmCacheCorruptionError(error)).toBe("Some other error");
  });
});
