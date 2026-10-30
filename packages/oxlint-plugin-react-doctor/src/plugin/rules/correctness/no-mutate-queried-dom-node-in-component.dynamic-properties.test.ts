import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMutateQueriedDomNodeInComponent } from "./no-mutate-queried-dom-node-in-component.js";

describe("queried DOM dynamic style properties", () => {
  it.each([
    ["mixed fixed height", "{ color: tone, height: 20 }", 'node.style.height = "40px"', 0],
    ["matching dynamic height", '{ height, color: "red" }', 'node.style.height = "40px"', 1],
    ["all static properties", '{ height: 20, color: "red" }', 'node.style.height = "40px"', 0],
    ["unrelated dynamic property", "{ color: tone }", 'node.style.height = "40px"', 0],
    ["quoted fixed property", '{ "height": 20, color: tone }', 'node.style.height = "40px"', 0],
    [
      "quoted dynamic property",
      '{ "height": height, color: "red" }',
      'node.style.height = "40px"',
      1,
    ],
    [
      "fixed custom property",
      '{ "--height": "20px", color: tone }',
      'node.style.setProperty("--height", "40px")',
      0,
    ],
    [
      "dynamic custom property",
      '{ "--height": height }',
      'node.style.setProperty("--height", "40px")',
      1,
    ],
    [
      "fixed normalized property",
      '{ backgroundColor: "red", height }',
      'node.style.setProperty("background-color", "blue")',
      0,
    ],
    [
      "dynamic normalized property",
      "{ backgroundColor: tone, height: 20 }",
      'node.style.setProperty("background-color", "blue")',
      1,
    ],
    [
      "dynamic then fixed duplicate",
      "{ height, height: 20, color: tone }",
      'node.style.height = "40px"',
      0,
    ],
    [
      "fixed then dynamic duplicate",
      '{ height: 20, height, color: "red" }',
      'node.style.height = "40px"',
      1,
    ],
    [
      "quoted final duplicate",
      '{ height, "height": 20, color: tone }',
      'node.style.height = "40px"',
      0,
    ],
    [
      "all dynamic values overwritten",
      "{ height, height: 20 }",
      'node.style.cssText = "height:40px"',
      0,
    ],
    ["spread before fixed key", "{ ...style, height: 20 }", 'node.style.height = "40px"', 1],
    ["spread after fixed key", "{ height: 20, ...style }", 'node.style.height = "40px"', 1],
    [
      "computed key before fixed key",
      "{ [property]: height, height: 20 }",
      'node.style.height = "40px"',
      1,
    ],
    ["computed fixed key", '{ ["height"]: 20, color: tone }', 'node.style.height = "40px"', 1],
    ["opaque style object", "style", 'node.style.height = "40px"', 1],
    ["conditional style object", "active ? {height:20} : style", 'node.style.height = "40px"', 1],
    [
      "cssText with dynamic style",
      "{ height: 20, color: tone }",
      'node.style.cssText = "height:40px"',
      1,
    ],
    [
      "cssText with static style",
      '{ height: 20, color: "red" }',
      'node.style.cssText = "height:40px"',
      0,
    ],
    [
      "unknown mutation key with dynamic style",
      "{ height: 20, color: tone }",
      'node.style[property] = "40px"',
      1,
    ],
    [
      "unknown mutation key with static style",
      '{ height: 20, color: "red" }',
      'node.style[property] = "40px"',
      0,
    ],
    ["static template value", "{ height: `20px`, color: tone }", 'node.style.height = "40px"', 0],
    [
      "wrapped literal value",
      "{ height: (20 as number), color: tone }",
      'node.style.height = "40px"',
      0,
    ],
    [
      "accessor value",
      '{ get height(){return height}, color: "red" }',
      'node.style.height = "40px"',
      1,
    ],
    ["method value", '{ height(){return height}, color: "red" }', 'node.style.height = "40px"', 1],
  ])("handles %s", (_name, style, mutation, expectedCount) => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel({tone,height,style,property,active}) {
        const node = document.getElementById("panel");
        ${mutation};
        return <div id="panel" style={${style}} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});

describe("queried DOM style surface independence", () => {
  it.each([
    [
      "dynamic shorthand overlaps literal longhand",
      "{ margin: gap, marginLeft: 20 }",
      'node.style.marginLeft = "40px"',
      1,
    ],
    [
      "dynamic longhand overlaps imperative shorthand",
      "{ margin: 20, marginLeft: gap }",
      'node.style.margin = "40px"',
      1,
    ],
    [
      "hyphenated setter overlaps dynamic shorthand",
      "{ margin: gap, marginLeft: 20 }",
      'node.style.setProperty("margin-left", "40px")',
      1,
    ],
    [
      "independent color and literal height",
      "{ color: tone, height: 20 }",
      'node.style.height = "40px"',
      0,
    ],
    [
      "independent physical margin longhands",
      "{ marginTop: gap, marginLeft: 20 }",
      'node.style.marginLeft = "40px"',
      0,
    ],
    [
      "same physical property stays reportable",
      "{ marginLeft: gap }",
      'node.style.marginLeft = "40px"',
      1,
    ],
    [
      "dynamic all cannot prove independence",
      "{ all: reset, height: 20 }",
      'node.style.height = "40px"',
      1,
    ],
    [
      "imperative all cannot prove independence",
      '{ color: tone, all: "initial" }',
      'node.style.all = "initial"',
      1,
    ],
    [
      "dynamic logical may overlap physical",
      "{ marginInlineStart: gap, marginLeft: 20 }",
      'node.style.marginLeft = "40px"',
      1,
    ],
    [
      "dynamic physical may overlap logical",
      "{ marginLeft: gap, marginInlineStart: 20 }",
      'node.style.marginInlineStart = "40px"',
      1,
    ],
    [
      "unknown dynamic cannot prove independence",
      "{ futureMargin: gap, height: 20 }",
      'node.style.height = "40px"',
      1,
    ],
    [
      "float alias cannot prove independence",
      '{ float: side, cssFloat: "left" }',
      'node.style.cssFloat = "right"',
      1,
    ],
    [
      "custom property names are case sensitive",
      '{ "--Height": gap, "--height": "20px" }',
      'node.style.setProperty("--height", "40px")',
      0,
    ],
    [
      "identical custom property stays reportable",
      '{ "--height": gap }',
      'node.style.setProperty("--height", "40px")',
      1,
    ],
    [
      "ordinary all cannot overwrite custom",
      '{ all: reset, "--height": "20px" }',
      'node.style.setProperty("--height", "40px")',
      0,
    ],
    [
      "custom cannot overwrite ordinary all",
      '{ "--height": gap, all: "initial" }',
      'node.style.all = "initial"',
      0,
    ],
    [
      "all static overlap remains quiet",
      "{ margin: 20, marginLeft: 10 }",
      'node.style.marginLeft = "40px"',
      0,
    ],
    [
      "font synthesis shorthand overlaps weight",
      '{ fontSynthesis: mode, fontSynthesisWeight: "none" }',
      'node.style.fontSynthesisWeight = "auto"',
      1,
    ],
    [
      "weight may overwrite imperative font synthesis",
      '{ fontSynthesis: "none", fontSynthesisWeight: mode }',
      'node.style.fontSynthesis = "weight"',
      1,
    ],
    [
      "font variant shorthand overlaps caps",
      '{ fontVariant: mode, fontVariantCaps: "normal" }',
      'node.style.fontVariantCaps = "small-caps"',
      1,
    ],
    [
      "caps may overwrite imperative font variant",
      '{ fontVariant: "normal", fontVariantCaps: mode }',
      'node.style.fontVariant = "small-caps"',
      1,
    ],
    [
      "whitespace shorthand overlaps text wrap mode",
      '{ whiteSpace: mode, textWrapMode: "wrap" }',
      'node.style.textWrapMode = "nowrap"',
      1,
    ],
    [
      "text wrap mode may overwrite imperative whitespace",
      '{ whiteSpace: "normal", textWrapMode: mode }',
      'node.style.whiteSpace = "nowrap"',
      1,
    ],
    [
      "reviewed font size and color are independent",
      '{ fontSize: gap, color: "red" }',
      'node.style.color = "blue"',
      0,
    ],
    [
      "reviewed physical padding and height are independent",
      "{ paddingTop: gap, height: 20 }",
      'node.style.height = "40px"',
      0,
    ],
    [
      "containIntrinsicBlockSize cannot certify physical independence",
      "{ containIntrinsicBlockSize: gap, containIntrinsicHeight: 20 }",
      'node.style.containIntrinsicHeight = "40px"',
      1,
    ],
    [
      "containIntrinsicInlineSize cannot certify physical independence",
      "{ containIntrinsicInlineSize: gap, containIntrinsicWidth: 20 }",
      'node.style.containIntrinsicWidth = "40px"',
      1,
    ],
    [
      "overflowBlock cannot certify physical independence",
      '{ overflowBlock: gap, overflowY: "hidden" }',
      'node.style.overflowY = "scroll"',
      1,
    ],
    [
      "overflowInline cannot certify physical independence",
      '{ overflowInline: gap, overflowX: "hidden" }',
      'node.style.overflowX = "scroll"',
      1,
    ],
    [
      "overscrollBehaviorBlock cannot certify physical independence",
      '{ overscrollBehaviorBlock: gap, overscrollBehaviorY: "contain" }',
      'node.style.overscrollBehaviorY = "none"',
      1,
    ],
    [
      "overscrollBehaviorInline cannot certify physical independence",
      '{ overscrollBehaviorInline: gap, overscrollBehaviorX: "contain" }',
      'node.style.overscrollBehaviorX = "none"',
      1,
    ],
    [
      "scrollMarginBlockStart cannot certify physical independence",
      "{ scrollMarginBlockStart: gap, scrollMarginTop: 20 }",
      'node.style.scrollMarginTop = "40px"',
      1,
    ],
    [
      "scrollMarginBlockEnd cannot certify physical independence",
      "{ scrollMarginBlockEnd: gap, scrollMarginBottom: 20 }",
      'node.style.scrollMarginBottom = "40px"',
      1,
    ],
    [
      "scrollMarginInlineStart cannot certify physical independence",
      "{ scrollMarginInlineStart: gap, scrollMarginLeft: 20 }",
      'node.style.scrollMarginLeft = "40px"',
      1,
    ],
    [
      "scrollMarginInlineEnd cannot certify physical independence",
      "{ scrollMarginInlineEnd: gap, scrollMarginRight: 20 }",
      'node.style.scrollMarginRight = "40px"',
      1,
    ],
    [
      "scrollPaddingBlockStart cannot certify physical independence",
      "{ scrollPaddingBlockStart: gap, scrollPaddingTop: 20 }",
      'node.style.scrollPaddingTop = "40px"',
      1,
    ],
    [
      "scrollPaddingBlockEnd cannot certify physical independence",
      "{ scrollPaddingBlockEnd: gap, scrollPaddingBottom: 20 }",
      'node.style.scrollPaddingBottom = "40px"',
      1,
    ],
    [
      "scrollPaddingInlineStart cannot certify physical independence",
      "{ scrollPaddingInlineStart: gap, scrollPaddingLeft: 20 }",
      'node.style.scrollPaddingLeft = "40px"',
      1,
    ],
    [
      "scrollPaddingInlineEnd cannot certify physical independence",
      "{ scrollPaddingInlineEnd: gap, scrollPaddingRight: 20 }",
      'node.style.scrollPaddingRight = "40px"',
      1,
    ],
  ])("%s", (_name, style, mutation, expectedCount) => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel({gap,tone,reset,side,mode}) {
        const node = document.getElementById("panel");
        ${mutation};
        return <div id="panel" style={${style}} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});

describe("queried DOM absent style properties", () => {
  it.each([
    ["dynamic transform leaves absent height quiet", "{ transform }", 'node.style.height = "40px"'],
    [
      "dynamic accentColor leaves absent height quiet",
      "{ accentColor }",
      'node.style.height = "40px"',
    ],
    [
      "shorthand-only style preserves absent longhand boundary",
      "{ margin: gap }",
      'node.style.marginTop = "40px"',
    ],
  ])("%s", (_name, style, mutation) => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel({transform,accentColor,gap}) {
        const node = document.getElementById("panel");
        ${mutation};
        return <div id="panel" style={${style}} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
