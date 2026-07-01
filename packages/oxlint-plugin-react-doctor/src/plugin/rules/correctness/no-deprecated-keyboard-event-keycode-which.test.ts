import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDeprecatedKeyboardEventKeycodeWhich } from "./no-deprecated-keyboard-event-keycode-which.js";

describe("no-deprecated-keyboard-event-keycode-which", () => {
  it("flags switch on event.which in a keyboard handler", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (event: KeyboardEvent) => {
         switch (event.which) {
           case 37: slidePrev(); break;
           case 39: slideNext(); break;
         }
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags if comparing keyCode to a numeric constant", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (e: React.KeyboardEvent) => {
         if (e.keyCode === 27) close();
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags keyCode compared to a non-literal enum member", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const handleKeyDown = (e: KeyboardEvent) => {
         if (e.keyCode === ArrowKeys.Left) {
           slide(SlideDirection.Left);
         }
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an untyped inline JSX onKeyDown handler", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const Row = () => <div onKeyDown={(e) => { if (e.keyCode === 13) submit(); }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet on mouse-button which detection", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onMouseDown = (e: MouseEvent) => {
         if (e.which === 3) return;
         if (e.which === 2) openInNewTab();
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on the keyCode === 229 IME idiom", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (e: KeyboardEvent) => {
         if (e.keyCode === 229) return;
         act();
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a key || which transitional fallback", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (event: KeyboardEvent) => {
         switch (event.key || event.which) {
           case 'Escape': close(); break;
           case 'ArrowLeft': slidePrev(); break;
         }
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on object-literal keyCode event synthesis", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `fireEvent.keyDown(el, { keyCode: 13 });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on an untyped receiver with no keyboard-handler context", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const handler = (e) => { if (e.keyCode === 27) close(); };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a dynamic computed member access", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (e: KeyboardEvent) => {
         const prop = 'keyCode';
         if (e[prop] === 27) close();
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when which is read alongside button in the same handler", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onPointer = (e: KeyboardEvent) => {
         if (e.button === 0) return;
         if (e.which === 3) contextMenu();
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
