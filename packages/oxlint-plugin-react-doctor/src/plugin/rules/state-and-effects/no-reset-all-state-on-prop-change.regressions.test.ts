import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noResetAllStateOnPropChange } from "./no-reset-all-state-on-prop-change.js";

describe("no-reset-all-state-on-prop-change — regressions", () => {
  it("stays silent for an extracted async loading lifecycle helper", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const Spline = ({ load, scene }) => {
        const [isLoading, setIsLoading] = useState(true);
        const initialize = async () => {
          await load(scene);
          setIsLoading(false);
        };
        useEffect(() => {
          setIsLoading(true);
          void initialize();
        }, [scene]);
        return <canvas hidden={isLoading} />;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for the authentic conditionally started loading helper shape", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useRef, useState } from "react";
      const Spline = ({ createApplication, onLoad, scene }) => {
        const canvasRef = useRef(null);
        const [isLoading, setIsLoading] = useState(true);
        const initialize = async (application, events) => {
          await application.load(scene);
          for (const event of events) application.addEventListener(event.name, event.callback);
          setIsLoading(false);
          onLoad?.(application);
        };
        useEffect(() => {
          setIsLoading(true);
          const events = [{ callback: onLoad, name: "load" }];
          if (canvasRef.current) {
            const application = createApplication(canvasRef.current);
            void initialize(application, events);
          }
        }, [scene]);
        return <canvas ref={canvasRef} hidden={isLoading} />;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "a function declaration",
      `async function initialize() { await load(scene); setIsLoading(false); }
      useEffect(() => { setIsLoading(true); initialize(); }, [scene]);`,
    ],
    [
      "an immutable helper alias chain",
      `const initialize = async () => { await load(scene); setIsLoading(false); };
      const initializeAlias = initialize;
      const runInitialize = initializeAlias;
      useEffect(() => { setIsLoading(true); void (runInitialize as typeof initialize)(); }, [scene]);`,
    ],
  ])("stays silent through %s", (_label, lifecycle) => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const Spline = ({ load, scene }) => {
        const [isLoading, setIsLoading] = useState(true);
        ${lifecycle}
        return <canvas hidden={isLoading} />;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "the helper is only passed to a timer",
      `const initialize = async () => { await load(scene); setIsLoading(false); };
      useEffect(() => { setIsLoading(true); setTimeout(initialize, 0); }, [scene]);`,
    ],
    [
      "the helper is never invoked",
      `const initialize = async () => { await load(scene); setIsLoading(false); };
      useEffect(() => { setIsLoading(true); void initialize; }, [scene]);`,
    ],
    [
      "the helper writes before its await",
      `const initialize = async () => { setIsLoading(false); await load(scene); };
      useEffect(() => { setIsLoading(true); void initialize(); }, [scene]);`,
    ],
    [
      "the await is conditional",
      `const initialize = async () => { if (shouldLoad) await load(scene); setIsLoading(false); };
      useEffect(() => { setIsLoading(true); void initialize(); }, [scene]);`,
    ],
    [
      "the post-await setter belongs to different state",
      `const initialize = async () => { await load(scene); setResult(scene); };
      useEffect(() => { setIsLoading(true); void initialize(); }, [scene]);`,
    ],
    [
      "the helper call is itself deferred",
      `const initialize = async () => { await load(scene); setIsLoading(false); };
      useEffect(() => { setIsLoading(true); queueMicrotask(() => initialize()); }, [scene]);`,
    ],
    [
      "the post-await setter is trapped in an uninvoked nested function",
      `const initialize = async () => {
        await load(scene);
        const finish = () => setIsLoading(false);
        void finish;
      };
      useEffect(() => { setIsLoading(true); void initialize(); }, [scene]);`,
    ],
    [
      "the helper call is unreachable",
      `const initialize = async () => { await load(scene); setIsLoading(false); };
      useEffect(() => { setIsLoading(true); return; initialize(); }, [scene]);`,
    ],
    [
      "the post-await setter is unreachable",
      `const initialize = async () => { await load(scene); return; setIsLoading(false); };
      useEffect(() => { setIsLoading(true); void initialize(); }, [scene]);`,
    ],
    [
      "the helper binding is reassigned",
      `let initialize = async () => { await load(scene); setIsLoading(false); };
      initialize = async () => load(scene);
      useEffect(() => { setIsLoading(true); void initialize(); }, [scene]);`,
    ],
  ])("still reports when %s", (_label, lifecycle) => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const Spline = ({ load, scene, setResult, shouldLoad }) => {
        const [isLoading, setIsLoading] = useState(true);
        ${lifecycle}
        return <canvas hidden={isLoading} />;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  // excalidraw ToolPopover: the setter only runs inside an event-subscription
  // callback registered by the effect, so state resets when the emitter
  // fires — not when the `app` prop changes.
  it("stays silent when the setter only runs inside a subscription callback", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const ToolPopover = ({ app }) => {
        const [isPopupOpen, setIsPopupOpen] = useState(false);
        useEffect(() => {
          const unsubscribe = app.onPointerDownEmitter.on(() => {
            setIsPopupOpen(false);
          });
          return () => unsubscribe?.();
        }, [app]);
        return <div>{String(isPopupOpen)}</div>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a synchronous all-state reset keyed on a prop", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const Profile = ({ userId }) => {
        const [comment, setComment] = useState("");
        useEffect(() => {
          setComment("");
        }, [userId]);
        return <textarea value={comment} onChange={(e) => setComment(e.target.value)} />;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("clears all state");
  });

  describe("Boolean render gating", () => {
    it("still reports when an overflow-menu dependency can change between truthy values", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useState } from "react";
        const TopNavigation = ({ menuTriggerVisible }: { menuTriggerVisible?: number[] }) => {
          const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
          useEffect(() => {
            setOverflowMenuOpen(false);
          }, [menuTriggerVisible]);
          const content = (isVirtual) => {
            const showMenuTrigger = isVirtual || menuTriggerVisible;
            return (
              <section
                aria-hidden={isVirtual ? true : undefined}
                className={isVirtual ? "measurement-hidden" : undefined}
              >
                {showMenuTrigger && <button aria-expanded={overflowMenuOpen}>Menu</button>}
              </section>
            );
          };
          return (
            <>
              {content(true)}
              {content(false)}
              {menuTriggerVisible && overflowMenuOpen && <div role="menu">Drawer</div>}
            </>
          );
        };`,
        { forceJsx: true },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("stays silent when a dismissed tooltip resets while its item is not highlighted", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useState } from "react";
        const Item = ({ highlighted, disabledReason }: { highlighted?: boolean; disabledReason: string }) => {
          const [canShowTooltip, setCanShowTooltip] = useState(true);
          useEffect(() => setCanShowTooltip(true), [highlighted]);
          return (
            <div>
              {highlighted && canShowTooltip && (
                <Tooltip content={disabledReason} onEscape={() => setCanShowTooltip(false)} />
              )}
            </div>
          );
        };`,
        { forceJsx: true },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still reports when the reset state has an exposed consumer outside the visibility gate", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useState } from "react";
        const TopNavigation = ({ menuTriggerVisible }) => {
          const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
          useEffect(() => {
            setOverflowMenuOpen(false);
          }, [menuTriggerVisible]);
          return (
            <>
              {menuTriggerVisible && overflowMenuOpen && <div role="menu">Drawer</div>}
              <output>{String(overflowMenuOpen)}</output>
            </>
          );
        };`,
        { forceJsx: true },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it.each([
      [
        "an immutable visibility alias",
        `const visibleGate = visible;
        return visibleGate && <div>{open}</div>;`,
      ],
      [
        "an inline handler on a hidden trigger",
        `return visible && <button onClick={() => notify(open)}>Menu</button>;`,
      ],
      ["a gated portal", `return visible && createPortal(<div>{open}</div>, document.body);`],
      [
        "TypeScript and parenthesis wrappers",
        `return ((visible as boolean) && <div>{(open satisfies boolean)}</div>);`,
      ],
      ["a custom child directly gated by visibility", `return visible && <Child value={open} />;`],
    ])("stays silent through %s", (_label, renderBody) => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useState } from "react";
        import { createPortal } from "react-dom";
        const Menu = ({ visible }: { visible: boolean }) => {
          const [open, setOpen] = useState(false);
          useEffect(() => setOpen(false), [visible]);
          ${renderBody}
        };`,
        { forceJsx: true },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when every reset state is gated by the same visibility transition", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useState } from "react";
        const Menu = ({ visible }: { visible: boolean }) => {
          const [open, setOpen] = useState(false);
          const [query, setQuery] = useState("");
          useEffect(() => {
            setOpen(false);
            setQuery("");
          }, [visible]);
          return visible && <div data-open={open}>{query}</div>;
        };`,
        { forceJsx: true },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it.each([
      [
        "after the visibility gate",
        `return visible && isAllowed() && open && <output onClick={() => setOpen(false)}>{String(open)}</output>;`,
      ],
      [
        "before the visibility gate",
        `return isAllowed() && visible && open && <output onClick={() => setOpen(false)}>{String(open)}</output>;`,
      ],
    ])("stays silent when an opaque condition appears %s", (_label, renderBody) => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useState } from "react";
        const Menu = ({ visible, isAllowed }: { visible: boolean; isAllowed: () => boolean }) => {
          const [open, setOpen] = useState(true);
          useEffect(() => setOpen(true), [visible]);
          ${renderBody}
        };`,
        { forceJsx: true },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it.each([
      [
        "there is no proven visibility gate",
        `return isAllowed() && open && <output onClick={() => setOpen(false)}>{String(open)}</output>;`,
      ],
      [
        "the visibility condition is only one branch of a disjunction",
        `return (visible || isAllowed()) && open && <output onClick={() => setOpen(false)}>{String(open)}</output>;`,
      ],
      [
        "the state is read before the visibility gate",
        `return isAllowed(open) && visible && <output onClick={() => setOpen(false)}>{String(open)}</output>;`,
      ],
      [
        "repeated opaque calls can produce different values",
        `return (visible || isAllowed()) && !isAllowed() && open && <output onClick={() => setOpen(false)}>{String(open)}</output>;`,
      ],
      [
        "the dependency is reassigned before its projected gate",
        `return (visible = true) && visible && open && <output onClick={() => setOpen(false)}>{String(open)}</output>;`,
      ],
      [
        "a local helper reassigns the dependency before its projected gate",
        `const reveal = () => {
          visible = true;
          return true;
        };
        return reveal() && visible && open && <output onClick={() => setOpen(false)}>{String(open)}</output>;`,
      ],
      [
        "a local helper conditionally mutates the dependency",
        `const toggleVisibility = () => {
          if (isAllowed()) visible = !visible;
          return true;
        };
        return toggleVisibility() && visible && open && <output onClick={() => setOpen(false)}>{String(open)}</output>;`,
      ],
    ])("still reports when %s", (_label, renderBody) => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useState } from "react";
        const Menu = ({ visible, isAllowed }: { visible: boolean; isAllowed: (value?: boolean) => boolean }) => {
          const [open, setOpen] = useState(true);
          useEffect(() => setOpen(true), [visible]);
          ${renderBody}
        };`,
        { forceJsx: true },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it.each([
      [
        "a string dependency remains visible across value changes",
        `import { useEffect, useState } from "react";
        const Menu = ({ userId }: { userId: string }) => {
          const [draft, setDraft] = useState("");
          useEffect(() => setDraft(""), [userId]);
          return userId && <output>{draft}</output>;
        };`,
      ],
      [
        "a nested same-name interface cannot change the dependency type",
        `import { useEffect, useState } from "react";
        interface Props { visible: string }
        namespace Other { export interface Props { visible: boolean } }
        const Menu = ({ visible }: Props) => {
          const [draft, setDraft] = useState("");
          useEffect(() => setDraft(""), [visible]);
          return visible && <output>{draft}</output>;
        };`,
      ],
      [
        "a nested interface can shadow a top-level Boolean interface",
        `import { useEffect, useState } from "react";
        interface Props { visible: boolean }
        const makeMenu = () => {
          interface Props { visible: string }
          const Menu = ({ visible }: Props) => {
            const [draft, setDraft] = useState("");
            useEffect(() => setDraft(""), [visible]);
            return visible && <output>{draft}</output>;
          };
          return Menu;
        };`,
      ],
      [
        "a type parameter can shadow a top-level Boolean interface",
        `import { useEffect, useState } from "react";
        interface Props { visible: boolean }
        const Menu = <Props extends { visible: string }>({ visible }: Props) => {
          const [draft, setDraft] = useState("");
          useEffect(() => setDraft(""), [visible]);
          return visible && <output>{draft}</output>;
        };`,
      ],
      [
        "a local type alias can shadow a top-level Boolean interface",
        `import { useEffect, useState } from "react";
        interface Props { visible: boolean }
        const makeMenu = () => {
          type Props = { visible: string };
          const Menu = ({ visible }: Props) => {
            const [draft, setDraft] = useState("");
            useEffect(() => setDraft(""), [visible]);
            return visible && <output>{draft}</output>;
          };
          return Menu;
        };`,
      ],
      [
        "a custom component can ignore hidden",
        `import { useEffect, useState } from "react";
        const Panel = ({ value }: { hidden: boolean; value: boolean }) => <output>{value}</output>;
        const Menu = ({ visible }: { visible: boolean }) => {
          const [open, setOpen] = useState(false);
          useEffect(() => setOpen(false), [visible]);
          return <Panel hidden={!visible} value={open} />;
        };`,
      ],
      [
        "a native hidden attribute does not prevent stale DOM state",
        `import { useEffect, useState } from "react";
        const Menu = ({ visible }: { visible: boolean }) => {
          const [open, setOpen] = useState(false);
          useEffect(() => setOpen(false), [visible]);
          return <button hidden={!visible} aria-expanded={open}>Menu</button>;
        };`,
      ],
      [
        "aria-hidden does not prevent stale visual state",
        `import { useEffect, useState } from "react";
        const Menu = ({ visible }: { visible: boolean }) => {
          const [open, setOpen] = useState(false);
          useEffect(() => setOpen(false), [visible]);
          return <div aria-hidden={!visible} aria-expanded={open} />;
        };`,
      ],
      [
        "a custom component can ignore aria-hidden",
        `import { useEffect, useState } from "react";
        const Panel = (props: { "aria-hidden": boolean; "aria-expanded": boolean }) => <button aria-expanded={props["aria-expanded"]}>Menu</button>;
        const Menu = ({ visible }: { visible: boolean }) => {
          const [open, setOpen] = useState(false);
          useEffect(() => setOpen(false), [visible]);
          return <Panel aria-hidden={!visible} aria-expanded={open} />;
        };`,
      ],
      [
        "a portal escapes a hidden DOM ancestor",
        `import { useEffect, useState } from "react";
        import { createPortal } from "react-dom";
        const Menu = ({ visible }: { visible: boolean }) => {
          const [open, setOpen] = useState(false);
          useEffect(() => setOpen(false), [visible]);
          return <div hidden={!visible}>{createPortal(<output>{open}</output>, document.body)}</div>;
        };`,
      ],
      [
        "an aliased portal import escapes a hidden DOM ancestor",
        `import { useEffect, useState } from "react";
        import { createPortal as mountPortal } from "react-dom";
        const Menu = ({ visible }: { visible: boolean }) => {
          const [open, setOpen] = useState(false);
          useEffect(() => setOpen(false), [visible]);
          return <div hidden={!visible}>{mountPortal(<output>{open}</output>, document.body)}</div>;
        };`,
      ],
      [
        "a const-aliased portal escapes a hidden DOM ancestor",
        `import { useEffect, useState } from "react";
        import { createPortal } from "react-dom";
        const mountPortal = createPortal;
        const Menu = ({ visible }: { visible: boolean }) => {
          const [open, setOpen] = useState(false);
          useEffect(() => setOpen(false), [visible]);
          return <div hidden={!visible}>{mountPortal(<output>{open}</output>, document.body)}</div>;
        };`,
      ],
      [
        "a custom child can portal through a hidden DOM ancestor",
        `import { useEffect, useState } from "react";
        import { createPortal } from "react-dom";
        const Child = ({ value }: { value: boolean }) => createPortal(<output>{value}</output>, document.body);
        const Menu = ({ visible }: { visible: boolean }) => {
          const [open, setOpen] = useState(false);
          useEffect(() => setOpen(false), [visible]);
          return <div hidden={!visible}><Child value={open} /><button onClick={() => setOpen(true)}>Open</button></div>;
        };`,
      ],
      [
        "an arbitrary class name has no hiding semantics",
        `import { useEffect, useState } from "react";
        const Menu = ({ visible }: { visible: boolean }) => {
          const [open, setOpen] = useState(false);
          useEffect(() => setOpen(false), [visible]);
          return <output className={!visible ? "not-hidden" : ""}>{open}</output>;
        };`,
      ],
      [
        "an opaque callback can dirty state while hidden",
        `import { useEffect, useState } from "react";
        const Menu = ({ visible, onRegister }: { visible: boolean; onRegister: (callback: () => void) => void }) => {
          const [open, setOpen] = useState(false);
          useEffect(() => setOpen(false), [visible]);
          useEffect(() => onRegister(() => setOpen(true)), [onRegister]);
          return visible && <output>{open}</output>;
        };`,
      ],
      [
        "the reset effect also exposes its setter",
        `import { useEffect, useState } from "react";
        const Menu = ({ visible, onRegister }: { visible: boolean; onRegister: (setter: (value: boolean) => void) => void }) => {
          const [open, setOpen] = useState(false);
          useEffect(() => {
            setOpen(false);
            onRegister(setOpen);
          }, [visible]);
          return visible && <output>{open}</output>;
        };`,
      ],
      [
        "the reset is observable from another effect",
        `import { useEffect, useState } from "react";
        const Menu = ({ visible }: { visible: boolean }) => {
          const [open, setOpen] = useState(false);
          useEffect(() => setOpen(false), [visible]);
          useEffect(() => notify(open), [open]);
          return visible && <button onClick={() => setOpen(true)}>{String(open)}</button>;
        };`,
      ],
    ])("still reports when %s", (_label, source) => {
      const result = runRule(noResetAllStateOnPropChange, source, { forceJsx: true });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it.each([
      [
        "the dependency is a negated visibility alias",
        `const hidden = !visible;
        useEffect(() => setOpen(false), [hidden]);
        return !hidden && <button onClick={() => setOpen(true)}>{String(open)}</button>;`,
      ],
      [
        "the state read is inside a gated map callback",
        `useEffect(() => setOpen(false), [visible]);
        return visible && items.map(item => (
          <button key={item} onClick={() => setOpen(true)}>{String(open)}</button>
        ));`,
      ],
      [
        "the visibility gate uses a strict Boolean comparison",
        `useEffect(() => setOpen(false), [visible]);
        return visible === true ? (
          <button onClick={() => setOpen(true)}>{String(open)}</button>
        ) : null;`,
      ],
      [
        "the state read is inside a singly invoked render helper",
        `useEffect(() => setOpen(false), [visible]);
        const renderContent = () => (
          <button onClick={() => setOpen(true)}>{String(open)}</button>
        );
        return visible && renderContent();`,
      ],
      [
        "a portal is directly gated before it escapes the tree",
        `useEffect(() => setOpen(false), [visible]);
        return visible && createPortal(<output>{open}</output>, document.body);`,
      ],
    ])("stays silent when %s", (_label, componentBody) => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useState } from "react";
        import { createPortal } from "react-dom";
        const Menu = ({ visible, items }: { visible: boolean; items: string[] }) => {
          const [open, setOpen] = useState(false);
          ${componentBody}
        };`,
        { forceJsx: true },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it.each([
      ["an inverse guard", `return !visible && <div>{open}</div>;`, "[visible]"],
      ["a second reset dependency", `return visible && <div>{open}</div>;`, "[visible, userId]"],
      [
        "a mutable guard alias",
        `let gate = visible;
        gate = Boolean(visible);
        return gate && <div>{open}</div>;`,
        "[visible]",
      ],
      [
        "a named event handler with opaque reachability",
        `const handleClick = () => notify(open);
        return visible && <button onClick={handleClick}>Menu</button>;`,
        "[visible]",
      ],
      [
        "an unguarded portal",
        `return createPortal(<div>{open}</div>, document.body);`,
        "[visible]",
      ],
      [
        "visually exposed aria-hidden content",
        `return <div aria-hidden={!visible}>{String(open)}</div>;`,
        "[visible]",
      ],
    ])("still reports through %s", (_label, renderBody, dependencies) => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useState } from "react";
        import { createPortal } from "react-dom";
        const Menu = ({ visible, userId }) => {
          const [open, setOpen] = useState(false);
          useEffect(() => setOpen(false), ${dependencies});
          ${renderBody}
        };`,
        { forceJsx: true },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("still reports when one of multiple reset states remains exposed", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useState } from "react";
        const Menu = ({ visible }) => {
          const [open, setOpen] = useState(false);
          const [query, setQuery] = useState("");
          useEffect(() => {
            setOpen(false);
            setQuery("");
          }, [visible]);
          return <><output>{query}</output>{visible && open && <div>Menu</div>}</>;
        };`,
        { forceJsx: true },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  describe("live prop normalizations", () => {
    it("stays silent when a transition tracker records the current Boolean-normalized prop", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import React, { useEffect, useRef, useState } from "react";
        function FocusLock({ disabled, restoreFocus }, ref) {
          const target = useRef(null);
          const [previouslyDisabled, setPreviouslyDisabled] = useState(!!disabled);
          useEffect(() => {
            if (previouslyDisabled !== !!disabled) {
              setPreviouslyDisabled(!!disabled);
              if (restoreFocus && disabled) target.current?.focus();
            }
          }, [previouslyDisabled, disabled, restoreFocus]);
          return <button ref={target} type="button">Target</button>;
        }
        export default React.forwardRef(FocusLock);`,
        { forceJsx: true },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it.each([
      ["double negation", "!!disabled", "!!disabled"],
      ["equivalent Boolean forms", "Boolean(disabled)", "!!disabled"],
      [
        "TypeScript wrappers",
        "(Boolean(disabled) as boolean)",
        "((Boolean(disabled) satisfies boolean)!)",
      ],
      ["whole-props member", "Boolean(props.disabled)", "!!props.disabled"],
    ])("stays silent through %s", (_label, initializer, nextValue) => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useState } from "react";
        const Tracker = (props: { disabled?: boolean }) => {
          const { disabled } = props;
          const [previouslyDisabled, setPreviouslyDisabled] = useState(${initializer});
          useEffect(() => {
            setPreviouslyDisabled(${nextValue});
          }, [disabled]);
          return previouslyDisabled;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent through an exact immutable normalization alias", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useState } from "react";
        const Tracker = ({ disabled }: { disabled?: boolean }) => {
          const normalizedDisabled = Boolean(disabled);
          const [previouslyDisabled, setPreviouslyDisabled] = useState(Boolean(disabled));
          useEffect(() => {
            setPreviouslyDisabled(normalizedDisabled as boolean);
          }, [normalizedDisabled]);
          return previouslyDisabled;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent through multi-hop immutable normalization aliases", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useState } from "react";
        const Tracker = ({ disabled }: { disabled?: boolean }) => {
          const directNormalization = Boolean(disabled);
          const normalizedDisabled = directNormalization;
          const [previouslyDisabled, setPreviouslyDisabled] = useState(Boolean(disabled));
          useEffect(() => {
            setPreviouslyDisabled(normalizedDisabled);
          }, [normalizedDisabled]);
          return previouslyDisabled;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("preserves the existing live-binding exemption for an opaque prop-derived const", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useState } from "react";
        const Tracker = ({ disabled }: { disabled?: boolean }) => {
          const normalizedDisabled = normalizeDisabled(disabled);
          const [previouslyDisabled, setPreviouslyDisabled] = useState(normalizedDisabled);
          useEffect(() => {
            setPreviouslyDisabled(normalizedDisabled);
          }, [normalizedDisabled]);
          return previouslyDisabled;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("preserves the existing live-binding exemption for a custom hook result", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useState } from "react";
        const DropdownOnToggleEffect = ({ onDropdownOpen }) => {
          const isDropdownOpen = useAtomComponentStateValue(isDropdownOpenComponentState);
          const [currentIsDropdownOpen, setCurrentIsDropdownOpen] = useState(isDropdownOpen);
          useEffect(() => {
            if (isDropdownOpen && !currentIsDropdownOpen) {
              setCurrentIsDropdownOpen(isDropdownOpen);
              onDropdownOpen?.();
            }
          }, [currentIsDropdownOpen, isDropdownOpen, onDropdownOpen]);
          return null;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when a transient reset accompanies a live prop mirror", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useState } from "react";
        const Editor = ({ disabled }: { disabled?: boolean }) => {
          const [previouslyDisabled, setPreviouslyDisabled] = useState(Boolean(disabled));
          const [draft, setDraft] = useState("");
          useEffect(() => {
            setPreviouslyDisabled(Boolean(disabled));
            setDraft("");
          }, [disabled]);
          return <output>{String(previouslyDisabled)}{draft}</output>;
        };`,
        { forceJsx: true },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("does not treat a shadowed useMemo lookalike as a React mount snapshot", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useState } from "react";
        const Tracker = ({ disabled }: { disabled?: boolean }) => {
          const useMemo = (callback: () => boolean) => callback();
          const normalizedDisabled = useMemo(() => Boolean(disabled));
          const [previouslyDisabled, setPreviouslyDisabled] = useState(normalizedDisabled);
          useEffect(() => {
            setPreviouslyDisabled(normalizedDisabled);
          }, [normalizedDisabled]);
          return previouslyDisabled;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it.each([
      [
        "mutable alias",
        `let normalizedDisabled = Boolean(disabled);
        const [previouslyDisabled, setPreviouslyDisabled] = useState(normalizedDisabled);
        useEffect(() => {
          normalizedDisabled = Boolean(disabled);
          setPreviouslyDisabled(normalizedDisabled);
        }, [disabled]);`,
      ],
      [
        "constant normalization",
        `const normalizedDisabled = Boolean(false);
        const [previouslyDisabled, setPreviouslyDisabled] = useState(normalizedDisabled);
        useEffect(() => {
          setPreviouslyDisabled(normalizedDisabled);
        }, [disabled]);`,
      ],
      [
        "mount snapshot",
        `const initialDisabledRef = useRef(Boolean(disabled));
        const [previouslyDisabled, setPreviouslyDisabled] = useState(initialDisabledRef.current);
        useEffect(() => {
          setPreviouslyDisabled(initialDisabledRef.current);
        }, [disabled]);`,
      ],
      [
        "aliased mount snapshot",
        `const initialDisabledRef = useRef(Boolean(disabled));
        const initialDisabled = initialDisabledRef.current;
        const [previouslyDisabled, setPreviouslyDisabled] = useState(initialDisabled);
        useEffect(() => {
          setPreviouslyDisabled(initialDisabled);
        }, [disabled]);`,
      ],
      [
        "memoized mount snapshot",
        `const initialDisabled = useMemo(() => Boolean(disabled), []);
        const [previouslyDisabled, setPreviouslyDisabled] = useState(initialDisabled);
        useEffect(() => {
          setPreviouslyDisabled(initialDisabled);
        }, [disabled]);`,
      ],
      [
        "aliased memoized mount snapshot",
        `const initialDisabled = useMemo(() => Boolean(disabled), []);
        const aliasedInitialDisabled = initialDisabled;
        const [previouslyDisabled, setPreviouslyDisabled] = useState(aliasedInitialDisabled);
        useEffect(() => {
          setPreviouslyDisabled(aliasedInitialDisabled);
        }, [disabled]);`,
      ],
      [
        "shadowed Boolean",
        `const Boolean = (value: unknown) => value;
        const [previouslyDisabled, setPreviouslyDisabled] = useState(Boolean(disabled));
        useEffect(() => {
          setPreviouslyDisabled(Boolean(disabled));
        }, [disabled]);`,
      ],
      [
        "module-scoped initial object",
        `const [previouslyDisabled, setPreviouslyDisabled] = useState(INITIAL_STATE);
        useEffect(() => {
          setPreviouslyDisabled(INITIAL_STATE);
        }, [disabled]);`,
      ],
      [
        "module-scoped initial primitive",
        `const [previouslyDisabled, setPreviouslyDisabled] = useState(INITIAL_TAG);
        useEffect(() => {
          setPreviouslyDisabled(INITIAL_TAG);
        }, [disabled]);`,
      ],
    ])("retains the diagnostic for a %s", (_label, componentBody) => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useMemo, useRef, useState } from "react";
        const INITIAL_STATE = {};
        const INITIAL_TAG = "all";
        const Tracker = ({ disabled }: { disabled?: boolean }) => {
          ${componentBody}
          return previouslyDisabled;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  describe("delta audit vs 0.7.1", () => {
    it("stays silent on the leading reset of an async resolve effect with cancellation cleanup (freecut inline-source-preview)", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `const InlineSourcePreviewContent = memo(function InlineSourcePreviewContent({ mediaId }) {
          const [blobUrl, setBlobUrl] = useState('');
          useEffect(() => {
            let cancelled = false;
            setBlobUrl('');
            resolveMediaUrl(mediaId)
              .then((url) => {
                if (!cancelled) {
                  setBlobUrl(url);
                }
              })
              .catch(() => {});
            return () => {
              cancelled = true;
            };
          }, [mediaId]);
          return null;
        });`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("does not let two call sites of one setter satisfy a two-useState component (freecut inline-composition-preview)", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `const InlineCompositionPreviewContent = memo(function InlineCompositionPreviewContent({ compositionId }) {
          const [resolvedTracks, setResolvedTracks] = useState(null);
          const [rendererReady, setRendererReady] = useState(false);
          const compositionInput = useMemo(() => buildInput(compositionId), [compositionId]);
          useEffect(() => {
            if (!compositionInput) {
              setResolvedTracks(null);
              return;
            }
            let cancelled = false;
            setResolvedTracks(null);
            const load = async () => {
              const next = await resolveMediaUrls(compositionInput.tracks);
              if (!cancelled) {
                setResolvedTracks(next);
              }
            };
            void load();
            return () => {
              cancelled = true;
            };
          }, [compositionId, compositionInput]);
          return null;
        });`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on a hidden-draft re-sync whose useState was seeded from a live binding (ant-design-mobile picker)", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `const Picker = memo(function Picker(props) {
          const { visible } = props;
          const [value, setValue] = usePropsValue(props);
          const [innerValue, setInnerValue] = useState(value);
          useEffect(() => {
            if (!visible) {
              setInnerValue(value);
            }
          }, [value]);
          return null;
        });`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags a reset to a const-literal named constant (upstream 'shared var' parity)", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `function ProfilePage({ userId }) {
          const initialState = 'meow meow';
          const [user, setUser] = useState(null);
          const [comment, setComment] = useState(initialState);
          useEffect(() => {
            setUser(null);
            setComment(initialState);
          }, [userId]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("still flags an all-state reset inside a memo(function) component (isProp widening kept)", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `const Profile = memo(function Profile({ userId }) {
          const [comment, setComment] = useState("");
          const [draft, setDraft] = useState(null);
          useEffect(() => {
            setComment("");
            setDraft(null);
          }, [userId]);
          return null;
        });`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  describe("docs-validation round 2 (shapes covered by the delta-audit fixes)", () => {
    it("stays silent on the semi-controlled visible mirror (coreui CAlert)", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `const CAlert = ({ visible }) => {
          const [_visible, setVisible] = useState(visible);
          useEffect(() => {
            setVisible(visible);
          }, [visible]);
          return _visible;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when one state re-syncs to a live binding during an imperative teardown (PortOS ScoreSheet)", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `function ScoreSheet({ score }) {
          const playerRef = useRef(null);
          const [isPlaying, setIsPlaying] = useState(false);
          const [activeIdx, setActiveIdx] = useState(-1);
          const scoreBpm = Number.isFinite(score.tempo) && score.tempo > 0 ? score.tempo : 90;
          const [tempo, setTempo] = useState(scoreBpm);
          useEffect(() => {
            if (playerRef.current) { playerRef.current.stop(); playerRef.current = null; }
            setIsPlaying(false);
            setActiveIdx(-1);
            setTempo(scoreBpm);
          }, [score, scoreBpm]);
          return tempo;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when the sole state syncs an external library instance, not a reset (dtale ColumnAnalysisChart)", () => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `function ColumnAnalysisChart({ fetchedChartData }) {
          const [chart, setChart] = useState();
          const chartRef = useRef(null);
          useEffect(() => {
            setChart(createChart(chartRef.current, fetchedChartData));
          }, [fetchedChartData]);
          return chart ? "y" : "n";
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });
});
