import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferKeybindLibrary } from "./prefer-keybind-library.js";

describe("prefer-keybind-library", () => {
  it("flags window keydown listener that checks a specific key", () => {
    const code = `
      function setup() {
        window.addEventListener("keydown", (event) => {
          if (event.key === "Escape") closeModal();
        });
      }
    `;
    const result = runRule(preferKeybindLibrary, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("react-hotkeys-hook");
  });

  it("flags document keydown listener that checks a modifier combo", () => {
    const code = `
      document.addEventListener("keydown", (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "k") openCommandPalette();
      });
    `;
    const result = runRule(preferKeybindLibrary, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags listener bound inside a useEffect with cleanup", () => {
    const code = `
      import { useEffect } from "react";
      const App = () => {
        useEffect(() => {
          const onKey = (event) => {
            if (event.key === "ArrowRight") next();
          };
          window.addEventListener("keydown", onKey);
          return () => window.removeEventListener("keydown", onKey);
        }, []);
        return null;
      };
    `;
    const result = runRule(preferKeybindLibrary, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves a separately-declared function handler (binding hop)", () => {
    const code = `
      function handleKey(event) {
        if (event.metaKey && event.key === "s") save();
      }
      document.addEventListener("keydown", handleKey);
    `;
    const result = runRule(preferKeybindLibrary, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags destructured-event handler ({ key })", () => {
    const code = `
      window.addEventListener("keydown", ({ key }) => {
        if (key === "Enter") submit();
      });
    `;
    const result = runRule(preferKeybindLibrary, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags destructure-in-body of the event param", () => {
    const code = `
      window.addEventListener("keyup", (event) => {
        const { key, shiftKey } = event;
        if (shiftKey && key === "Tab") focusPrev();
      });
    `;
    const result = runRule(preferKeybindLibrary, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a keyCode-based handler (legacy property)", () => {
    const code = `
      el.addEventListener("keydown", function (event) {
        if (event.keyCode === 27) dismiss();
      });
    `;
    const result = runRule(preferKeybindLibrary, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags keypress listeners too", () => {
    const code = `
      window.addEventListener("keypress", (e) => {
        if (e.key === "/") focusSearch();
      });
    `;
    const result = runRule(preferKeybindLibrary, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a switch over event.key", () => {
    const code = `
      window.addEventListener("keydown", (event) => {
        switch (event.key) {
          case "j": down(); break;
          case "k": up(); break;
        }
      });
    `;
    const result = runRule(preferKeybindLibrary, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("suggests an already-imported keybind library over the default", () => {
    const code = `
      import { useHotkeys } from "react-hotkeys-hook";
      import hotkeys from "hotkeys-js";
      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") close();
      });
    `;
    const result = runRule(preferKeybindLibrary, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("react-hotkeys-hook");
  });

  it("suggests tinykeys when that is the project's keybind library", () => {
    const code = `
      import { tinykeys } from "tinykeys";
      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") close();
      });
    `;
    const result = runRule(preferKeybindLibrary, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("tinykeys");
  });

  // ---- false-positive traps -------------------------------------------

  it("does NOT flag a keydown listener that never inspects the key", () => {
    const code = `
      window.addEventListener("keydown", () => {
        setUserIsTyping(true);
      });
    `;
    const result = runRule(preferKeybindLibrary, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a handler that only calls preventDefault", () => {
    const code = `
      window.addEventListener("keydown", (event) => {
        event.preventDefault();
      });
    `;
    const result = runRule(preferKeybindLibrary, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag non-keyboard event listeners", () => {
    const code = `
      window.addEventListener("scroll", (event) => {
        if (event.key === "Escape") never();
      });
      window.addEventListener("click", (event) => doThing(event.key));
    `;
    const result = runRule(preferKeybindLibrary, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a shadowed inner param that happens to use .key", () => {
    const code = `
      window.addEventListener("keydown", (e) => {
        items.forEach((e) => render(e.key));
      });
    `;
    const result = runRule(preferKeybindLibrary, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag .key access on an unrelated object inside the handler", () => {
    const code = `
      window.addEventListener("keydown", (event) => {
        log(record.key, props.code);
      });
    `;
    const result = runRule(preferKeybindLibrary, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a non-string (computed) event name", () => {
    const code = `
      window.addEventListener(EVENT_NAME, (event) => {
        if (event.key === "Escape") close();
      });
    `;
    const result = runRule(preferKeybindLibrary, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag an unresolved (imported) handler", () => {
    const code = `
      import { handleKey } from "./keys";
      window.addEventListener("keydown", handleKey);
    `;
    const result = runRule(preferKeybindLibrary, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag addEventListener with only one argument", () => {
    const code = `window.addEventListener("keydown");`;
    const result = runRule(preferKeybindLibrary, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a same-named method that isn't addEventListener", () => {
    const code = `
      emitter.on("keydown", (event) => {
        if (event.key === "Escape") close();
      });
    `;
    const result = runRule(preferKeybindLibrary, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag inside a testlike file (tags: test-noise)", () => {
    const code = `
      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") close();
      });
    `;
    const result = runRule(preferKeybindLibrary, code, { filename: "shortcuts.test.ts" });
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags each distinct hand-rolled listener once", () => {
    const code = `
      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") close();
      });
      document.addEventListener("keyup", (e) => {
        if (e.metaKey && e.key === "Enter") send();
      });
    `;
    const result = runRule(preferKeybindLibrary, code);
    expect(result.diagnostics).toHaveLength(2);
  });
});
