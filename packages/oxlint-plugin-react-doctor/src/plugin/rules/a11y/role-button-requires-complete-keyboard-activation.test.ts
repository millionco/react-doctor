import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { roleButtonRequiresCompleteKeyboardActivation } from "./role-button-requires-complete-keyboard-activation.js";

const run = (code: string) =>
  runRule(roleButtonRequiresCompleteKeyboardActivation, code, { filename: "control.tsx" });

describe("role-button-requires-complete-keyboard-activation", () => {
  it("reports a role button that recognizes only Enter", () => {
    const result = run(`
      const Control = ({ activate }) => (
        <div
          role="button"
          tabIndex={0}
          onClick={activate}
          onKeyDown={(event) => {
            if (event.key === "Enter") activate();
          }}
        />
      );
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("Space");
  });

  it("reports a role button that recognizes only Space through event.code", () => {
    const result = run(`
      const handleKeyUp = (keyboardEvent) => {
        if ("Space" === keyboardEvent.code) activate();
      };
      const Control = () => (
        <span role={'button'} tabIndex={0} onClick={activate} onKeyUp={handleKeyUp} />
      );
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("Enter");
  });

  it("recognizes Enter and Space across separate keyboard handlers", () => {
    const result = run(`
      const Control = ({ activate }) => (
        <div
          role="button"
          tabIndex={0}
          onClick={activate}
          onKeyDown={(event) => event.key === "Enter" && activate()}
          onKeyUp={(event) => event.key === " " && activate()}
        />
      );
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("recognizes event key and code switch cases", () => {
    const result = run(`
      const Control = ({ activate }) => (
        <>
          <div
            role="button"
            tabIndex={0}
            onClick={activate}
            onKeyDown={(event) => {
              switch (event.key) {
                case "Enter":
                case " ":
                  activate();
              }
            }}
          />
          <span
            role="button"
            tabIndex={0}
            onClick={activate}
            onKeyDown={(event) => {
              switch (event.code) {
                case "Enter":
                case "NumpadEnter":
                case "Space":
                  activate();
              }
            }}
          />
        </>
      );
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("recognizes legacy Spacebar equality guards", () => {
    const result = run(`
      const Control = ({ activate }) => (
        <div
          role="button"
          tabIndex={0}
          onClick={activate}
          onKeyDown={(event) => {
            if (event["key"] === "Enter" || event.key === "Spacebar") activate();
          }}
        />
      );
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores inequality and negated equality guards", () => {
    const result = run(`
      const Control = ({ activate }) => (
        <>
          <div
            role="button"
            onClick={activate}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              activate();
            }}
          />
          <span
            role="button"
            onClick={activate}
            onKeyDown={(event) => {
              if (!(event.key === "Enter")) return;
              activate();
            }}
          />
        </>
      );
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores key comparisons that only log or prevent default behavior", () => {
    const result = run(`
      const Control = ({ activate, track }) => (
        <>
          <div
            role="button"
            onClick={activate}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                console.log("enter");
              }
            }}
          />
          <span
            role="button"
            onClick={activate}
            onKeyDown={(event) => {
              if (event.key === "Enter") track("keyboard");
            }}
          />
        </>
      );
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports when the guarded branch invokes the click action", () => {
    const result = run(`
      const Control = ({ activate }) => (
        <div
          role="button"
          onClick={() => activate()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              activate();
            }
          }}
        />
      );
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("Space");
  });

  it("ignores handlers with no recognizable activation branch", () => {
    const result = run(`
      const Control = ({ activate, activationKey }) => (
        <>
          <div role="button" tabIndex={0} onClick={activate} onKeyDown={() => activate()} />
          <span
            role="button"
            tabIndex={0}
            onClick={activate}
            onKeyDown={(event) => event.key === activationKey && activate()}
          />
          <a
            role="button"
            tabIndex={0}
            onClick={activate}
            onKeyDown={(event) => event.key === "Escape" && activate()}
          />
          <div
            role="button"
            tabIndex={0}
            onClick={activate}
            onKeyDown={(event) => event.key === "Enter" && activate()}
            onKeyUp={() => activate()}
          />
        </>
      );
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores unresolved, dynamic, and delegated keyboard handlers", () => {
    const result = run(`
      import { importedKeyHandler } from "./keyboard";
      const delegatedKeyHandler = (event) => activateFromKeyboard(event);
      const Control = ({ activate, dynamicKeyHandler }) => (
        <>
          <div role="button" onClick={activate} onKeyDown={importedKeyHandler} />
          <div role="button" onClick={activate} onKeyDown={dynamicKeyHandler} />
          <div role="button" onClick={activate} onKeyDown={delegatedKeyHandler} />
          <div
            role="button"
            onClick={activate}
            onKeyDown={(event) => {
              if (event.key === "Enter") activate();
              activateFromKeyboard(event);
            }}
          />
          <div
            role="button"
            onClick={() => {
              activate();
              track();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") activateFromKeyboard(event);
            }}
          />
        </>
      );
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not mistake unrelated calls for activation when the click action is opaque", () => {
    const result = run(`
      const Control = ({ activate, track }) => (
        <div
          role="button"
          onClick={() => {
            activate();
            track("click");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") track("keyboard");
          }}
        />
      );
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores spreads, native buttons, custom components, and non-button roles", () => {
    const result = run(`
      const Control = ({ activate, props }) => (
        <>
          <div
            role="button"
            onClick={activate}
            onKeyDown={(event) => event.key === "Enter" && activate()}
            {...props}
          />
          <button role="button" onClick={activate} onKeyDown={(event) => event.key === "Enter" && activate()} />
          <ControlButton role="button" onClick={activate} onKeyDown={(event) => event.key === "Enter" && activate()} />
          <div role="menuitem" onClick={activate} onKeyDown={(event) => event.key === "Enter" && activate()} />
          <div role={props.role} onClick={activate} onKeyDown={(event) => event.key === "Enter" && activate()} />
        </>
      );
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not count nested or shadowed event comparisons", () => {
    const result = run(`
      const Control = ({ activate }) => (
        <div
          role="button"
          tabIndex={0}
          onClick={activate}
          onKeyDown={(event) => {
            if (event.key === "Enter") activate();
            queueMicrotask(() => event.key === " " && activate());
            {
              const event = { code: "Space" };
              if (event.code === "Space") activate();
            }
          }}
        />
      );
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("Space");
  });
});
