import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { attachParentReferences } from "./attach-parent-references.js";
import { readImmutableQueryClientExport } from "./read-immutable-query-client-export.js";

// Authored fixtures. Canonical package and relative provider qualification are
// separate resolver inputs; these tests exercise only the module AST contract.
const SOURCE = `import { QueryClient as Client } from "@tanstack/react-query";
import { requestPolicy as policy } from "./settings";
const cache = new Client({ defaultOptions: { queries: policy }, retries: 2 });
export { cache as sharedClient };
`;
const inspect = (source: string, exportedName = "sharedClient") => {
  const parsed = parseFixture(source, { filename: "cache.ts" });
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  return readImmutableQueryClientExport(
    parsed.program,
    analyzeScopes(parsed.program),
    exportedName,
  );
};

describe("immutable local QueryClient export", () => {
  it("returns direct named options import coordinates", () => {
    expect(inspect(SOURCE)).toEqual({
      localName: "cache",
      optionsImport: { source: "./settings", importedName: "requestPolicy", localName: "policy" },
    });
  });

  it("supports an exported const without an options module", () => {
    expect(
      inspect(`import { QueryClient } from "@tanstack/react-query";
export const sharedClient = new QueryClient();`),
    ).toEqual({ localName: "sharedClient", optionsImport: null });
  });

  it.each([
    ["mutable binding", SOURCE.replace("const cache", "let cache")],
    ["different constructor provider", SOURCE.replace('"@tanstack/react-query"', '"other-query"')],
    ["type-only constructor", SOURCE.replace("import { QueryClient", "import type { QueryClient")],
    ["type-only options", SOURCE.replace("import { requestPolicy", "import type { requestPolicy")],
    ["bare options import", SOURCE.replace('"./settings"', '"settings"')],
    [
      "namespace options",
      SOURCE.replace("import { requestPolicy as policy }", "import * as policy"),
    ],
    ["default options", SOURCE.replace("import { requestPolicy as policy }", "import policy")],
    [
      "reexport",
      SOURCE.replace(
        "export { cache as sharedClient };",
        'export { cache as sharedClient } from "./other";',
      ),
    ],
    [
      "default export",
      SOURCE.replace("export { cache as sharedClient };", "export default cache;"),
    ],
    [
      "constructor alias",
      SOURCE.replace(
        "const cache = new Client",
        "const Factory = Client; const cache = new Factory",
      ),
    ],
    ["factory call", SOURCE.replace("new Client(", "Client(")],
    ["cast constructor", SOURCE.replace("new Client(", "new (Client as any)(")],
    [
      "cast export",
      SOURCE.replace("export { cache as sharedClient };", "export default cache as any;"),
    ],
    ["options spread", SOURCE.replace("queries: policy", "...policy")],
    ["options call", SOURCE.replace("queries: policy", "queries: makePolicy()")],
    ["options member read", SOURCE.replace("queries: policy", "queries: policy.queries")],
    ["options cast", SOURCE.replace("queries: policy", "queries: policy as any")],
    ["options getter", SOURCE.replace("queries: policy", "get queries() { return policy; }")],
    ["computed option key", SOURCE.replace("queries: policy", '["queries"]: policy')],
    ["prototype option", SOURCE.replace("queries: policy", "__proto__: policy")],
    ["duplicate keys", SOURCE.replace("queries: policy", "queries: policy, queries: policy")],
    ["extra constructor argument", SOURCE.replace("retries: 2 });", "retries: 2 }, policy);")],
    ["extra reference", SOURCE.replace("export { cache", "inspectCache(cache); export { cache")],
    ["extra runtime import", SOURCE.replace("const cache", 'import "./patch"; const cache')],
  ])("declines %s", (_name, source) => {
    expect(inspect(source)).toBeNull();
  });

  it("requires the requested exported name", () => {
    expect(inspect(SOURCE, "differentClient")).toBeNull();
  });
});
