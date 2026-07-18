import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDeprecatedKeyboardEventKeycodeWhich } from "./no-deprecated-keyboard-event-keycode-which.js";

describe("no-deprecated-keyboard-event-keycode-which", () => {
  it("flags switch on event.which over layout-sensitive letter codes", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (event: KeyboardEvent) => {
         switch (event.which) {
           case 65: moveLeft(); break;
           case 68: moveRight(); break;
         }
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags keyCode compared to a layout-sensitive punctuation literal", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (e: React.KeyboardEvent) => {
         if (e.keyCode === 191) openSearch();
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags keyCode compared to a same-file const resolving to a letter code", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const KEY_S = 83;
       const onKeyDown = (e: KeyboardEvent) => {
         if (e.keyCode === KEY_S) save();
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a relational character-range check on keyCode", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (e: KeyboardEvent) => {
         if (e.keyCode >= 65 && e.keyCode <= 90) typeLetter();
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags any charCode branch even against a control-key code", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyPress = (e: KeyboardEvent) => {
         if (e.charCode === 32) toggle();
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an untyped inline JSX onKeyDown handler comparing a letter code", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const Row = () => <div onKeyDown={(e) => { if (e.keyCode === 75) focusSearch(); }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a class arrow-field keyboard handler comparing a letter code", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `class Modal extends React.Component {
         handleKeyDown = (e) => {
           if (e.keyCode === 191) this.props.onSlash();
         };
         render() { return <div onKeyDown={this.handleKeyDown} />; }
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a class method keyboard handler comparing a letter code", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `class Grid extends React.Component {
         onKeyDown(e) {
           if (e.keyCode === 65) this.selectAll();
         }
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet on layout-invariant control-key literals (ant-design-style Escape check)", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (e: React.KeyboardEvent) => {
         if (e.keyCode === 27) close();
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a switch over arrow-key codes (carousel navigation idiom)", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (event: KeyboardEvent) => {
         switch (event.which) {
           case 37: slidePrev(); break;
           case 39: slideNext(); break;
         }
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on unresolvable named key constants (shared KeyCode module idiom)", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const handleKeyDown = (e: KeyboardEvent) => {
         if (e.keyCode === ArrowKeys.Left) {
           slide(SlideDirection.Left);
         }
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a same-file const resolving to a control-key code", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const ESCAPE_KEY = 27;
       const onKeyDown = (e: KeyboardEvent) => {
         if (e.keyCode === ESCAPE_KEY) close();
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on an else-if progressive-enhancement fallback after an event.key branch", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (event: KeyboardEvent) => {
         if (event.key !== undefined) {
           if (event.key === "/") openSearch();
         } else if (event.keyCode === 191) {
           openSearch();
         }
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a ternary feature-detect fallback between event.key and keyCode", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (event: KeyboardEvent) => {
         const isSlash = event.key !== undefined ? event.key === "/" : event.keyCode === 191;
         if (isSlash) openSearch();
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on an early-return event.key guard before a keyCode fallback", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (event: KeyboardEvent) => {
         if (event.key) {
           handleByKey(event.key);
           return;
         }
         if (event.keyCode === 191) openSearch();
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
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
      `const handler = (e) => { if (e.keyCode === 65) select(); };`,
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

  it("flags a layout-sensitive keyCode branch when event.key is only logged", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (event: KeyboardEvent) => {
         console.log(event.key);
         if (event.keyCode === 65) selectAll();
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags when unrelated event.key logic does not control the deprecated branch", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (event: KeyboardEvent) => {
         if (event.key === "Escape") close();
         if (event.keyCode === 65) selectAll();
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when a key-derived comparison guards the fallback", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (event: KeyboardEvent) => {
         if (event.key.toLowerCase() === 'a') { selectAll(); return; }
         if (event.keyCode === 65) selectAll();
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when event.key is aliased for later logic", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (event: KeyboardEvent) => {
         const pressed = event.key;
         if (event.keyCode === 65 && pressed !== 'a') selectAll();
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when event.key feeds a matcher helper whose result branches", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (event: KeyboardEvent) => {
         if (isHotkey(event.key)) { selectAll(); return; }
         if (event.keyCode === 65) selectAll();
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags when event.key only rides an analytics payload", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (event: KeyboardEvent) => {
         analytics({ key: event.key });
         if (event.keyCode === 65) selectAll();
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet: Destructured { key } feature-guard with keyCode fallback (the rule's own blessed idiom, via destructuring)", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (event: KeyboardEvent) => {
  const { key } = event;
  if (key !== undefined) {
    if (key === '/') openSearch();
    return;
  }
  if (event.keyCode === 191) openSearch();
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: 'key' in event feature detection guarding the keyCode fallback", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (event: KeyboardEvent) => {
  if ('key' in event) {
    handleByKey(event);
    return;
  }
  if (event.keyCode === 191) openSearch();
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Relational range check over layout-invariant arrow keys 37-40", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (e: KeyboardEvent) => {
  if (e.keyCode >= 37 && e.keyCode <= 40) {
    e.preventDefault();
    moveFocus(e.keyCode);
  }
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Scroll-lock preventDefault over navigation keys 32-40", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (e: KeyboardEvent) => {
  if (e.keyCode >= 32 && e.keyCode <= 40) {
    e.preventDefault();
  }
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Skip bare modifier presses (16-18) while recording a hotkey", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (e: KeyboardEvent) => {
  if (e.keyCode >= 16 && e.keyCode <= 18) return;
  recordHotkey(e.key);
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Android/legacy IME guard: keyCode === 229 || keyCode === 0", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (event: KeyboardEvent) => {
  if (event.keyCode === 229 || event.keyCode === 0) return;
  commitPendingText();
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Session-replay log matcher on a stored keystroke record (not a KeyboardEvent)", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `interface ReplayKeystroke { keyCode: number; ctrlKey: boolean; }
const labelKeyDownEntry = (entry: ReplayKeystroke) =>
  entry.keyCode === 90 && entry.ctrlKey ? 'undo' : 'other';`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a relational range that includes letter codes", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (e: KeyboardEvent) => {
         if (e.keyCode >= 65 && e.keyCode <= 90) {
           handleLetter(e.keyCode);
         }
       };`,
    );
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it("still flags bounds joined by OR because they do not form a closed invariant range", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (event: KeyboardEvent) => {
         if (event.keyCode >= 37 || event.keyCode <= 40) moveFocus();
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it("does not resolve a mutable key code binding from its stale initializer", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (event: KeyboardEvent) => {
         let enterCode = 65;
         enterCode = 13;
         if (event.keyCode === enterCode) submit();
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a one-sided relational check with no invariant upper bound", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (e: KeyboardEvent) => {
         if (e.keyCode >= 48) {
           handlePrintable(e.keyCode);
         }
       };`,
    );
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it("still flags when a destructured binding reads an unrelated property", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (event: KeyboardEvent) => {
         const { shiftKey } = event;
         if (event.keyCode === 65 && shiftKey) selectAll();
       };`,
    );
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it("does not flag keyCode branching inside bundled build output", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `element.addEventListener("keydown", (e) => { if (e.keyCode === 13) submit(); });`,
      { filename: "/repo/docs/build/0.355cdadd.js" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when event.key is destructured under a renamed binding for fallback logic", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (event) => {
         const { key: logicalKey } = event;
         if (logicalKey ? logicalKey === "a" : event.keyCode === 65) select();
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still reports through transparent TypeScript wrappers", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (event) => { if ((event.keyCode as number) === 65) select(); };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let a shadowed nested event.key read suppress the outer deprecated branch", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (event) => {
         const inspect = (event) => event.key === "a";
         if (event.keyCode === 65) select(inspect(recorded));
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let an unused standardized-key destructure suppress the deprecated branch", () => {
    const result = runRule(
      noDeprecatedKeyboardEventKeycodeWhich,
      `const onKeyDown = (event) => {
         const { key } = event;
         log(key);
         if (event.keyCode === 65) select();
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
