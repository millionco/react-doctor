import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { attachParentReferences } from "./attach-parent-references.js";
import { getSupportedNextIntlRequestPath } from "./get-supported-next-intl-request-path.js";

// Public authored fixtures. Provider qualification is a separate caller proof.
const SOURCE = `import type { NextConfig } from "next";
import makeIntl from "next-intl/plugin";
const wrapConfig = makeIntl("./src/localization/request.ts");
const config: NextConfig = { output: "standalone" };
export default wrapConfig(config);
`;

const inspect = (source: string, qualifiedVersion: string | null = "4.0.2") => {
  const parsed = parseFixture(source, { filename: "next.config.ts" });
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  const scopes = analyzeScopes(parsed.program);
  return getSupportedNextIntlRequestPath(parsed.program, scopes, qualifiedVersion);
};

describe("qualified next-intl static config", () => {
  it("recognizes a direct literal request path and standalone config", () => {
    expect(inspect(SOURCE)).toBe("./src/localization/request.ts");
  });

  it("permits the same static JavaScript shape without type syntax", () => {
    expect(
      inspect(
        SOURCE.replace('import type { NextConfig } from "next";\n', "").replace(": NextConfig", ""),
      ),
    ).toBe("./src/localization/request.ts");
  });

  it.each([null, "4.0.1", "4.0.3", "^4.0.2"])(
    "declines unqualified provider version %s",
    (version) => {
      expect(inspect(SOURCE, version)).toBeNull();
    },
  );

  it.each([
    ["different plugin", SOURCE.replace('"next-intl/plugin"', '"custom/plugin"')],
    ["type-only plugin", SOURCE.replace("import makeIntl", "import type makeIntl")],
    ["mutable wrapper", SOURCE.replace("const wrapConfig", "let wrapConfig")],
    ["mutable config", SOURCE.replace("const config", "let config")],
    [
      "plugin options",
      SOURCE.replace(
        '"./src/localization/request.ts"',
        '{ requestConfig: "./src/localization/request.ts" }',
      ),
    ],
    [
      "dynamic request path",
      SOURCE.replace('makeIntl("./src/localization/request.ts")', "makeIntl(getPath())"),
    ],
    [
      "absolute request path",
      SOURCE.replace('"./src/localization/request.ts"', '"/outside/request.ts"'),
    ],
    [
      "custom webpack",
      SOURCE.replace(
        '{ output: "standalone" }',
        '{ output: "standalone", webpack(config) { return config; } }',
      ),
    ],
    [
      "custom turbo alias",
      SOURCE.replace(
        '{ output: "standalone" }',
        '{ output: "standalone", experimental: { turbo: { resolveAlias: { local: "other" } } } }',
      ),
    ],
    [
      "config spread",
      SOURCE.replace('{ output: "standalone" }', '{ ...other, output: "standalone" }'),
    ],
    [
      "config getter",
      SOURCE.replace('{ output: "standalone" }', '{ get output() { return "standalone"; } }'),
    ],
    ["computed property", SOURCE.replace('output: "standalone"', '["output"]: "standalone"')],
    [
      "wrapper alias",
      SOURCE.replace(
        "export default wrapConfig(config);",
        "const alias = wrapConfig; export default alias(config);",
      ),
    ],
    [
      "exported config function",
      SOURCE.replace(
        "export default wrapConfig(config);",
        "export default () => wrapConfig(config);",
      ),
    ],
    ["extra execution", SOURCE.replace("export default", "configure(config);\nexport default")],
    [
      "extra plugin import",
      SOURCE.replace("const wrapConfig", 'import extra from "other-plugin";\nconst wrapConfig'),
    ],
    ["optional invocation", SOURCE.replace("wrapConfig(config)", "wrapConfig?.(config)")],
    ["extra wrapper argument", SOURCE.replace("wrapConfig(config)", "wrapConfig(config, extra)")],
    ["wrong lexical config", SOURCE.replace("wrapConfig(config)", "wrapConfig(otherConfig)")],
  ])("declines %s", (_name, source) => {
    expect(inspect(source)).toBeNull();
  });
});
