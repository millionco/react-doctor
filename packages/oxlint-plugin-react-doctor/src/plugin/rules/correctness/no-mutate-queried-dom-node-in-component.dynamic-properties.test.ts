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
