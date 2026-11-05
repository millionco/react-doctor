import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule, runRuleOnParsedFixture } from "../../../test-utils/run-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { noUnescapedEntities } from "./no-unescaped-entities.js";

describe("no-unescaped-entities raw JSX text", () => {
  it.each([true, false])("ignores decoded entity values with raw field %s", (hasRaw) => {
    const source = "<span>It&apos;s &quot;safe&quot; &gt; &#125;</span>";
    const parsed = parseFixture(source);
    walkAst(parsed.program, (node) => {
      if (!isNodeOfType(node, "JSXText")) return;
      node.value = 'It\'s "safe" > }';
      if (!hasRaw) Reflect.deleteProperty(node, "raw");
    });

    const result = runRuleOnParsedFixture(noUnescapedEntities, source, parsed);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps numeric and nested literal entity spellings quiet", () => {
    const result = runRule(
      noUnescapedEntities,
      "<span>&#39; &#x22; &#62; &#x7d; &amp;apos; &amp;#39;</span>",
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still reports a literal quote in text containing an entity", () => {
    const result = runRule(noUnescapedEntities, "<span>🌿 It's raw &quot;here&quot;</span>");

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("`'`");
  });
});
