import { describe, expect, it } from "vite-plus/test";
import { extractFailedPluginName } from "../src/utils/extract-failed-plugin-name.js";

describe("extractFailedPluginName", () => {
  it("extracts plugin name from POSIX-style paths", () => {
    const error = new Error("Error loading /repo/vite.config.ts");
    expect(extractFailedPluginName(error)).toBe("vite");
  });

  it("extracts plugin name from Windows-style paths", () => {
    const error = new Error("Error loading C:\\repo\\next.config.ts");
    expect(extractFailedPluginName(error)).toBe("next");
  });

  it("extracts plugin name from a bare filename without a leading path", () => {
    const error = new Error("Error loading vite.config.ts");
    expect(extractFailedPluginName(error)).toBe("vite");
  });

  it("extracts plugin name with hyphens", () => {
    const error = new Error("Error loading /repo/i18next-parser.config.js");
    expect(extractFailedPluginName(error)).toBe("i18next-parser");
  });

  it("walks the cause chain when the top-level error has no path", () => {
    const cause = new Error("Error loading /repo/cypress.config.ts");
    const error = new Error("Knip run failed", { cause });
    expect(extractFailedPluginName(error)).toBe("cypress");
  });

  it("handles parsing errors with the same shape", () => {
    const error = new Error("Error parsing /repo/playwright.config.js");
    expect(extractFailedPluginName(error)).toBe("playwright");
  });

  it("normalizes uppercase plugin names", () => {
    const error = new Error("Error loading /repo/Next.config.ts");
    expect(extractFailedPluginName(error)).toBe("next");
  });

  it("returns null when the error has no recognizable config file", () => {
    expect(extractFailedPluginName(new Error("Some unrelated failure"))).toBeNull();
  });

  it("returns null for non-error values without crashing", () => {
    expect(extractFailedPluginName(undefined)).toBeNull();
    expect(extractFailedPluginName(null)).toBeNull();
    expect(extractFailedPluginName("oops")).toBeNull();
  });

  it("avoids infinite recursion on a circular cause chain", () => {
    const error = new Error("outer");
    Object.assign(error, { cause: error });
    expect(extractFailedPluginName(error)).toBeNull();
  });
});
