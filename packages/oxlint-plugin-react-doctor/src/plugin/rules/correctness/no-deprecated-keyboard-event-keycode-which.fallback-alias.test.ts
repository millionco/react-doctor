import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDeprecatedKeyboardEventKeycodeWhich } from "./no-deprecated-keyboard-event-keycode-which.js";

const legacyFallback = "event.keyCode || event.which || event.charCode";
const digitSwitch = "switch (numericKey) { case 49: activate(); break; }";

const runKeyboardHandler = (body: string, eventType = "KeyboardEvent") =>
  runRule(
    noDeprecatedKeyboardEventKeycodeWhich,
    `const handleKeyDown = (event: ${eventType}) => {
       ${body}
     };
     document.addEventListener("keydown", handleKeyDown);`,
    { includeLocations: true },
  );

describe("no-deprecated-keyboard-event-keycode-which legacy fallback aliases", () => {
  it("reports the first member once for a read-only let in a named handler", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `function handleKeydown(event) {
  let numericKey = ${legacyFallback};
  let didActivate = false;
  switch (numericKey) {
    case 27: close(); break;
    case 37: previous(); break;
    case 49: if (event.ctrlKey) didActivate = true; break;
  }
  if (didActivate) activate();
}
const bindKeyboard = (method) => document[method]("keydown", handleKeydown, true);
bindKeyboard("addEventListener");
bindKeyboard("removeEventListener");`,
      { includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ line: 2, column: 19, nodeType: "MemberExpression" }),
    ]);
  });

  it.each(["event.keyCode || event.which", "event.keyCode || (event.which || event.charCode)"])(
    "reports a const fallback using %s",
    (fallback) => {
      const result = runKeyboardHandler(`const numericKey = ${fallback}; ${digitSwitch}`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("preserves every existing diagnostic on the direct fallback", () => {
    const result = runKeyboardHandler(`switch (${legacyFallback}) { case 49: activate(); break; }`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it.each([
    ["an unswitched binding", `const numericKey = ${legacyFallback}; consume(numericKey);`],
    ["a declaration after the switch", `${digitSwitch} const numericKey = ${legacyFallback};`],
    ["a write", `let numericKey = ${legacyFallback}; numericKey = 27; ${digitSwitch}`],
    [
      "a captured write",
      `let numericKey = ${legacyFallback}; const overwrite = () => { numericKey = 27; }; overwrite(); ${digitSwitch}`,
    ],
    ["a nonadjacent switch", `const numericKey = ${legacyFallback}; unrelated(); ${digitSwitch}`],
    [
      "an intervening initializer call",
      `let numericKey = ${legacyFallback}; let didActivate = initialize(); ${digitSwitch}`,
    ],
    [
      "intervening destructuring",
      `let numericKey = ${legacyFallback}; const { value = initialize() } = {}; ${digitSwitch}`,
    ],
    [
      "an intervening initializer that writes the alias",
      `let numericKey = ${legacyFallback}; let didActivate = (numericKey = 27); ${digitSwitch}`,
    ],
    [
      "another declarator in the alias statement",
      `let numericKey = ${legacyFallback}, didActivate = initialize(); ${digitSwitch}`,
    ],
    [
      "two intervening declarations",
      `let numericKey = ${legacyFallback}; let didActivate = false; let another = false; ${digitSwitch}`,
    ],
    [
      "a fallback and switch nested in another block",
      `if (ready) { const numericKey = ${legacyFallback}; ${digitSwitch} }`,
    ],
    ["an extra read", `const numericKey = ${legacyFallback}; ${digitSwitch} consume(numericKey);`],
    [
      "a second alias",
      `const numericKey = ${legacyFallback}; const otherKey = numericKey; switch (otherKey) { case 49: activate(); }`,
    ],
    ["a var declaration", `var numericKey = ${legacyFallback}; ${digitSwitch}`],
    ["a nested callback", `const numericKey = ${legacyFallback}; defer(() => { ${digitSwitch} });`],
    [
      "a shadowed alias",
      `const numericKey = ${legacyFallback}; { const numericKey = 49; ${digitSwitch} }`,
    ],
    ["an unreachable switch", `return; const numericKey = ${legacyFallback}; ${digitSwitch}`],
    [
      "a replaced event parameter",
      `event = replacement; const numericKey = ${legacyFallback}; ${digitSwitch}`,
    ],
    [
      "a second event receiver",
      `const numericKey = event.keyCode || otherEvent.which; ${digitSwitch}`,
    ],
    [
      "a shadowed event",
      `{ const event = otherEvent; const numericKey = ${legacyFallback}; ${digitSwitch} }`,
    ],
    [
      "mouse button logic",
      `if (event.button) return; const numericKey = ${legacyFallback}; ${digitSwitch}`,
    ],
    [
      "a call mixed into the fallback",
      `const numericKey = event.keyCode || event.which || fallback(); ${digitSwitch}`,
    ],
    ["an optional receiver", `const numericKey = event?.keyCode || event.which; ${digitSwitch}`],
    [
      "control-only branches",
      `const numericKey = ${legacyFallback}; switch (numericKey) { case 27: close(); break; case 37: previous(); break; }`,
    ],
    [
      "IME-only branches",
      `const numericKey = ${legacyFallback}; switch (numericKey) { case 229: case 0: return; }`,
    ],
    [
      "a modern key guard",
      `if (event.key) { handleByKey(event.key); return; } const numericKey = ${legacyFallback}; ${digitSwitch}`,
    ],
    [
      "a modern code fallback",
      `const numericKey = event.code || event.keyCode || event.which; ${digitSwitch}`,
    ],
  ])("stays quiet with %s", (_label, body) => {
    const result = runKeyboardHandler(body);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet on a mouse event receiver", () => {
    const result = runKeyboardHandler(
      `const numericKey = ${legacyFallback}; ${digitSwitch}`,
      "MouseEvent",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
