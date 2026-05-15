import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { canOxlintExtendConfig } from "../src/core/can-oxlint-extend-config.js";

let temporaryDirectory: string;

const writeJson = (targetPath: string, payload: object): void => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(payload));
};

beforeEach(() => {
  temporaryDirectory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rd-can-extend-")));
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("canOxlintExtendConfig", () => {
  it("always returns true for .oxlintrc.json (oxlint-native)", () => {
    const oxlintrcPath = path.join(temporaryDirectory, ".oxlintrc.json");
    writeJson(oxlintrcPath, { extends: ["next"] });
    expect(canOxlintExtendConfig(oxlintrcPath)).toBe(true);
  });

  it("returns true for an .eslintrc.json without extends", () => {
    const eslintrcPath = path.join(temporaryDirectory, ".eslintrc.json");
    writeJson(eslintrcPath, { rules: { "no-debugger": "error" } });
    expect(canOxlintExtendConfig(eslintrcPath)).toBe(true);
  });

  it("returns true for an .eslintrc.json with empty extends", () => {
    const eslintrcPath = path.join(temporaryDirectory, ".eslintrc.json");
    writeJson(eslintrcPath, { extends: [] });
    expect(canOxlintExtendConfig(eslintrcPath)).toBe(true);
  });

  it("returns false for an .eslintrc.json with only bare-package extends (Next.js style)", () => {
    const eslintrcPath = path.join(temporaryDirectory, ".eslintrc.json");
    writeJson(eslintrcPath, { extends: ["next/core-web-vitals", "prettier"] });
    expect(canOxlintExtendConfig(eslintrcPath)).toBe(false);
  });

  it("returns false for an .eslintrc.json with only plugin: extends", () => {
    const eslintrcPath = path.join(temporaryDirectory, ".eslintrc.json");
    writeJson(eslintrcPath, {
      extends: ["plugin:@typescript-eslint/recommended", "plugin:react/recommended"],
    });
    expect(canOxlintExtendConfig(eslintrcPath)).toBe(false);
  });

  it("returns false for a single-string bare-package extends", () => {
    const eslintrcPath = path.join(temporaryDirectory, ".eslintrc.json");
    writeJson(eslintrcPath, { extends: "next" });
    expect(canOxlintExtendConfig(eslintrcPath)).toBe(false);
  });

  it("returns true when at least one extends entry is a local path", () => {
    const eslintrcPath = path.join(temporaryDirectory, ".eslintrc.json");
    writeJson(eslintrcPath, { extends: ["next", "./shared/eslint.json"] });
    expect(canOxlintExtendConfig(eslintrcPath)).toBe(true);
  });

  it("returns true on malformed JSON (let oxlint surface the real error)", () => {
    const eslintrcPath = path.join(temporaryDirectory, ".eslintrc.json");
    fs.writeFileSync(eslintrcPath, "{ this is not json");
    expect(canOxlintExtendConfig(eslintrcPath)).toBe(true);
  });

  // HACK: regression for the null-safety bug — `JSON.parse("null")` returns
  // a literal null and `parsed.extends` would have thrown a TypeError that
  // propagates out of the pre-screen entirely.
  it("returns true on non-object JSON (null, array, primitive)", () => {
    for (const payload of ["null", "[]", "42", '"a string"']) {
      const eslintrcPath = path.join(temporaryDirectory, ".eslintrc.json");
      fs.writeFileSync(eslintrcPath, payload);
      expect(canOxlintExtendConfig(eslintrcPath)).toBe(true);
    }
  });

  // HACK: real-world ESLint configs are routinely JSONC. Strict
  // `JSON.parse` would throw on `// commented out option` and the
  // pre-screen would fall through to "let oxlint try" — the exact
  // misleading-warning path we're trying to avoid.
  it("handles `//` line comments inside .eslintrc.json (JSONC)", () => {
    const eslintrcPath = path.join(temporaryDirectory, ".eslintrc.json");
    fs.writeFileSync(
      eslintrcPath,
      `{
  // pin to next preset for app router
  "extends": ["next", "plugin:@typescript-eslint/recommended"],
  "rules": {
    // "off-for-now": "off"
  }
}
`,
    );
    expect(canOxlintExtendConfig(eslintrcPath)).toBe(false);
  });

  it("handles `/* */` block comments inside .eslintrc.json (JSONC)", () => {
    const eslintrcPath = path.join(temporaryDirectory, ".eslintrc.json");
    fs.writeFileSync(
      eslintrcPath,
      `{
  /* multi-line
     comment */
  "extends": ["next"]
}
`,
    );
    expect(canOxlintExtendConfig(eslintrcPath)).toBe(false);
  });

  it("does not strip `//` sequences inside string values", () => {
    const eslintrcPath = path.join(temporaryDirectory, ".eslintrc.json");
    fs.writeFileSync(
      eslintrcPath,
      `{
  "extends": ["./shared//slashy-but-still-local.json"]
}
`,
    );
    expect(canOxlintExtendConfig(eslintrcPath)).toBe(true);
  });
});
