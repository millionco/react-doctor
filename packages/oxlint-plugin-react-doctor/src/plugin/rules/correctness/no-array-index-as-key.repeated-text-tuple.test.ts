import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

const source = `import visual from "./banner.module.css";
const glyphs = ["A", "Q", "X"] as const;

const Banner = () => (
  <span>{[...glyphs, ...glyphs].map((glyph, index) => (
    <span key={index} className={visual.character}>{glyph}</span>
  ))}</span>
);`;

describe("repeated fixed text positions", () => {
  it("recognizes an immutable repeated tuple rendered as native text", () => {
    const result = runRule(noArrayIndexAsKey, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reads JSX directives through the host semantic context", () => {
    const rule = wrapWithSemanticContext(noArrayIndexAsKey);
    expect(runRule(rule, source).diagnostics).toEqual([]);
    expect(runRule(rule, `/** @jsx customFactory */\n${source}`).diagnostics).toHaveLength(1);
  });

  it.each([
    ["receives caller data", source.replace('["A", "Q", "X"] as const', "liveGlyphs")],
    ["exports the tuple", source.replace("const glyphs", "export const glyphs")],
    ["leaks the tuple", source.replace("const Banner", "capture(glyphs);\nconst Banner")],
    ["mutates the tuple", source.replace("const Banner", "glyphs.reverse();\nconst Banner")],
    [
      "spreads an unrelated array",
      source.replace("...glyphs, ...glyphs", "...glyphs, ...visibleGlyphs"),
    ],
    [
      "replaces the native map",
      source.replace("const Banner", "Array.prototype.map = customMap;\nconst Banner"),
    ],
    [
      "replaces the inherited iterator",
      source.replace(
        "const Banner",
        "Array.prototype[Symbol.iterator] = customIterator;\nconst Banner",
      ),
    ],
    [
      "recovers the constructor",
      source.replace("const Banner", "[].constructor.prototype.map = customMap;\nconst Banner"),
    ],
    [
      "assigns a loop target",
      source.replace("const Banner", "for (Array.prototype.map of alternatives) {}\nconst Banner"),
    ],
    [
      "assigns a destructuring target",
      source.replace(
        "const Banner",
        "const target = importedPrototype; [target.map] = [alternate];\nconst Banner",
      ),
    ],
    [
      "passes a computed prototype",
      source.replace(
        "const Banner",
        "const target = ['old']; reconfigure(target[capability]);\nconst Banner",
      ),
    ],
    [
      "installs a legacy accessor",
      source.replace(
        "const Banner",
        "function read(target, key) { return target[key]; } read([], '__proto__').__defineGetter__('map', () => alternate);\nconst Banner",
      ),
    ],
    [
      "evaluates through the browser realm",
      source.replace("const Banner", "document.defaultView.eval('replaceMap()');\nconst Banner"),
    ],
    [
      "uses a string timer callback",
      source.replace("const Banner", "window.setInterval('replaceMap()', 10);\nconst Banner"),
    ],
    [
      "executes a style binding",
      source.replace("const Banner", "(visual.activate as any)();\nconst Banner"),
    ],
    ["has a custom JSX pragma", `/** @jsx customFactory */\n${source}`],
    [
      "uses an opaque JSX tag",
      source.replace("<span key=", "<Entry key=").replace("{glyph}</span>", "{glyph}</Entry>"),
    ],
    [
      "creates a stateful child",
      source.replace("{glyph}</span>", "<input defaultValue={glyph} /></span>"),
    ],
    ["uses the item to select a record", source.replace("{glyph}</span>", "{rows[glyph]}</span>")],
    ["adds another key", source.replace("key={index}", 'key={index} key="same"')],
    ["spreads attributes", source.replace("key={index}", "key={index} {...override}")],
    ["takes an opaque class prop", source.replace("visual.character", "visual[glyph]")],
  ])("keeps reporting when the list %s", (_reason, code) => {
    const result = runRule(noArrayIndexAsKey, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
