import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";
import { clearExhaustiveDepsSuppressionCache } from "./exhaustive-deps-suppression.js";

describe("react-builtins/exhaustive-deps — regressions", () => {
  it.each([
    [
      "a shadowing local",
      `import { useEffect } from "react";
      const C = ({ value }) => {
        const useEffect = (callback) => callback();
        useEffect(() => consume(value), []);
      };`,
    ],
    [
      "a function parameter",
      `const C = ({ value, useEffect }) => {
        useEffect(() => consume(value), []);
      };`,
    ],
    [
      "an arbitrary object method",
      `const C = ({ value, engine }) => {
        engine.useEffect(() => consume(value), []);
      };`,
    ],
  ])("does not treat %s as a React effect", (_name, code) => {
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // A module-scope constant used only as a parameter default is stable
  // across renders, so it must NOT be reported as a missing dependency.
  // Previously a manual (unfiltered) param-default walk added it
  // unconditionally; the scope analyzer now records the reference so the
  // normal module-scope filter excludes it.
  it("does not flag a module-scope constant used as a parameter default", () => {
    const code = `
      const SOME_MODULE_CONST = { a: 1 };
      function MyComponent() {
        return useCallback((opts = SOME_MODULE_CONST) => opts, []);
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).not.toContain("SOME_MODULE_CONST");
  });

  // A Solid-style accessor call listed in deps (`[language.intl()]`)
  // declares the same member chain the capture side keys (`language.intl`),
  // so it must NOT be reported as a missing dep / complex dep.
  it("does not flag a member accessor call listed in deps", () => {
    const code = `
      function MyComponent({ language }) {
        useEffect(() => {
          console.log(language.intl());
        }, [language.intl()]);
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).not.toContain("language");
    expect(messages).not.toContain("complex");
  });

  it("does not flag a bare accessor call listed in deps", () => {
    const code = `
      function MyComponent({ activeFileTab }) {
        useEffect(() => {
          console.log(activeFileTab());
        }, [activeFileTab()]);
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).not.toContain("activeFileTab");
  });

  // Regression guard for the other direction: a genuine component-scope
  // value used as a parameter default is still reported when omitted from
  // the dependency array (the fix must not silence real findings).
  it("still flags a component-scope value used as a parameter default", () => {
    const code = `
      function MyComponent({ value }) {
        return useCallback((opts = value) => opts, []);
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("value");
  });

  // The render callback passed directly to forwardRef/memo is a
  // component by construction, even under a non-PascalCase binding
  // (`const _Wrapped = forwardRef(...)`). Without that promotion the
  // component-scope boundary resolves to null and captures from an
  // enclosing factory scope are wrongly reported as missing deps —
  // they live outside the component, so they can't change between
  // renders.
  it("does not flag factory-scope captures inside a forwardRef callback under an underscore-prefixed binding", () => {
    const code = `
      import { forwardRef, useEffect } from "react";
      const buildComponent = (logger) => {
        const _Wrapped = forwardRef((props, ref) => {
          useEffect(() => {
            logger(props.value);
          }, [props.value]);
          return <div ref={ref} />;
        });
        return _Wrapped;
      };
    `;
    const result = runRule(exhaustiveDeps, code, { filename: "fixture.tsx" });
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).not.toContain("logger");
  });

  // A computed member anywhere in a zero-arg call's callee
  // (`items[index]()`) is a dynamic per-render lookup — keying it by
  // the collapsed root name would silently satisfy the `items` capture.
  // It must stay a complex dep.
  it("reports a complex dep for a computed-member callee call", () => {
    const code = `
      function MyComponent({ items, index, other }) {
        useEffect(() => {
          console.log(other);
        }, [items[index]()]);
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("A complex expression");
  });

  it("does not let a computed-member callee call satisfy the root capture", () => {
    const code = `
      function MyComponent({ items, index }) {
        useEffect(() => {
          console.log(items[0]);
        }, [items[index]()]);
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("A complex expression");
    expect(messages).toContain("`items`");
  });

  // A zero-arg call of a component-scope function rebuilt every render
  // must fire the same unstable-dep warning as the identifier form —
  // the memo re-runs every render either way.
  it("flags a zero-arg call of an unstable local function in deps", () => {
    const code = `
      function MyComponent({ data }) {
        const getConfig = () => ({ mode: data.mode });
        const value = useMemo(() => transform(getConfig()), [getConfig()]);
        return value;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("`getConfig` is rebuilt every render");
  });

  it("still flags the identifier form of an unstable local function dep", () => {
    const code = `
      function MyComponent({ data }) {
        const getConfig = () => ({ mode: data.mode });
        const value = useMemo(() => transform(getConfig()), [getConfig]);
        return value;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("`getConfig` is rebuilt every render");
  });

  // Solid signal accessors are not function-value symbols, so the
  // unstable-dep gate must not fire on them.
  it("stays silent on a Solid signal accessor call in deps", () => {
    const code = `
      function Counter() {
        const [count] = createSignal(0);
        useEffect(() => {
          console.log(count());
        }, [count()]);
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // The real opencode Solid-port shape the accessor fix targeted —
  // must stay fully silent.
  it("stays silent on the opencode Solid-port member accessor shape", () => {
    const code = `
      import { useLanguage } from "@/context/language";
      function SessionContextTab() {
        const language = useLanguage();
        const usd = useMemo(
          () =>
            new Intl.NumberFormat(language.intl(), {
              style: "currency",
              currency: "USD",
            }),
          [language.intl()],
        );
        const formatter = useMemo(
          () => createSessionContextFormatter(language.intl()),
          [language.intl()],
        );
        return usd.format(1) + String(formatter);
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // An UNUSED zero-arg call dep re-runs the hook because the call
  // RESULT changes every render, not because the callee binding
  // changes — the callee-keyed unnecessary-dep message would be
  // factually wrong, so the complex-expression message fires instead.
  it("reports a complex dep, not an unnecessary dep, for an unused Date.now() dep", () => {
    const code = `
      function MyComponent({ label }) {
        useEffect(() => {
          console.log(label);
        }, [label, Date.now()]);
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("A complex expression");
    expect(messages).not.toContain("re-runs whenever `Date.now` changes");
  });

  it("reports a complex dep for an unused imported zero-arg call dep", () => {
    const code = `
      import { uuid } from "./uuid";
      function MyComponent({ label }) {
        useEffect(() => {
          console.log(label);
        }, [label, uuid()]);
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("A complex expression");
    expect(messages).not.toContain("re-runs whenever `uuid` changes");
  });

  // FN anchors: the react-big-calendar timegutter mined-bug list
  // zero-arg calls in deps but the callbacks capture the bare objects —
  // the accessor keying must not swallow the missing-dep reports.
  it("still reports the timegutter mined useMemo bug", () => {
    const code = `
      import { adjustForDST } from './utils';
      const TimeGutter = ({ min, max, timeslots, step, localizer, components }) => {
        const { start, end } = useMemo(
          () => adjustForDST({ min, max, localizer }),
          [min?.toISOString(), max?.toISOString(), localizer]
        );
        return start && end ? null : null;
      };
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("min");
    expect(messages).toContain("max");
  });

  it("still reports the timegutter mined useEffect bug", () => {
    const code = `
      import { getSlotMetrics } from './utils';
      const TimeGutter = ({ min, max, timeslots, step, localizer }) => {
        const [slotMetrics, setSlotMetrics] = useState(
          getSlotMetrics({ min, max, timeslots, step, localizer })
        );
        useEffect(() => {
          if (slotMetrics) {
            setSlotMetrics(
              slotMetrics.update({ min, max, timeslots, step, localizer })
            );
          }
        }, [min?.toISOString(), max?.toISOString(), timeslots, step]);
        return null;
      };
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages.length).toBeGreaterThan(0);
    expect(messages).toContain("localizer");
  });

  it("still reports a call with arguments in deps as complex", () => {
    const code = `
      function MyComponent({ compute, value }) {
        useEffect(() => {
          console.log(compute(value));
        }, [compute(value)]);
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("A complex expression");
  });

  it("truncates prop-ref member chains at .current instead of demanding mutable paths", () => {
    const code = `
      function ChatInput({ textareaRef, content }) {
        useEffect(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = \`\${textareaRef.current.scrollHeight}px\`;
          }
        }, [content]);
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("textareaRef");
    expect(messages).not.toContain("textareaRef.current");
  });

  it("still reports the truncated prop-ref root when it is missing from deps", () => {
    const code = `
      function MyComponent({ myRef }) {
        useCallback(() => { console.log(myRef.current.innerHTML); }, []);
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("myRef");
  });

  it("does not warn about cleanup ref reads when the ref is only assigned by React via JSX", () => {
    const code = `
      function MyComponent() {
        const areaRef = useRef(null);
        const attach = (node) => { areaRef.current = node; };
        useEffect(() => {
          const handle = () => {};
          areaRef.current?.addEventListener("mousedown", handle);
          return () => {
            areaRef.current?.removeEventListener("mousedown", handle);
          };
        }, []);
        return <div ref={attach} />;
      }
    `;
    const result = runRule(exhaustiveDeps, code, { filename: "fixture.tsx" });
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).not.toContain("wrong node");
  });

  it("still warns about cleanup ref reads when the ref is never assigned in the component", () => {
    const code = `
      function MyComponent() {
        const areaRef = useRef(null);
        useEffect(() => {
          const handle = () => {};
          areaRef.current?.addEventListener("mousedown", handle);
          return () => {
            areaRef.current?.removeEventListener("mousedown", handle);
          };
        }, []);
        return <div ref={areaRef} />;
      }
    `;
    const result = runRule(exhaustiveDeps, code, { filename: "fixture.tsx" });
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("wrong node");
  });

  it("treats an explicit undefined deps argument like an omitted one for effect hooks", () => {
    const code = `
      function MyComponent({ focusAndScrollRef }) {
        useLayoutEffect(
          () => {
            focusAndScrollRef.apply = false;
          },
          undefined
        );
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports an explicit undefined deps argument for hooks that require deps", () => {
    const code = `
      function MyComponent({ compute }) {
        const value = useMemo(() => compute(), undefined);
        return value;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("useMemo");
  });

  it("suggests aggregate props when the only props call is a nested chain like props.api.load()", () => {
    const code = `
      function MyComponent(props) {
        useEffect(() => {
          console.log(props.a, props.b);
          props.api.load();
        }, []);
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("props");
  });

  it("still reports a null deps argument on an effect hook as a non-array deps list", () => {
    const code = `
      function MyComponent(props) {
        useEffect(() => {
          console.log(props.foo);
        }, null);
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // Cloudscape's use-split-panel-focus-control: a const object whose
  // properties are useRef() calls holds the SAME ref objects every
  // render, so `refs.slider` etc. can never be stale.
  it("does not flag member paths into a const object of useRef calls", () => {
    const code = `
      function useSplitPanelFocusControl(dependencies) {
        const refs = {
          toggle: useRef(null),
          slider: useRef(null),
          preferences: useRef(null),
        };
        const lastInteraction = useRef(null);
        useEffect(() => {
          switch (lastInteraction.current?.type) {
            case 'open':
              refs.slider.current?.focus();
              break;
            case 'close':
              refs.toggle.current?.focus();
              break;
            default:
              refs.preferences.current?.focus();
          }
          lastInteraction.current = null;
        }, dependencies);
        return refs;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a non-ref property read from a per-render object literal", () => {
    const code = `
      function MyComponent({ value }) {
        const container = { data: value, ref: useRef(null) };
        useEffect(() => {
          console.log(container.data);
        }, []);
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("container.data");
  });

  // Stable-identity wrapper hooks (ahooks useMemoizedFn, MUI
  // useEventCallback, useStableCallback, …) return a callback whose
  // identity never changes and which always invokes the latest closure.
  it("does not flag a useMemoizedFn handler omitted from effect deps", () => {
    const code = `
      import { useMemoizedFn } from 'ahooks';
      function NativeInput(props) {
        const inputRef = useRef(null);
        const handleClick = useMemoizedFn((event) => {
          props.onChange(event.target.checked);
        });
        useEffect(() => {
          const input = inputRef.current;
          if (!input) return;
          input.addEventListener('click', handleClick);
          return () => {
            input.removeEventListener('click', handleClick);
          };
        }, [props.disabled]);
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).not.toContain("handleClick");
  });

  it("does not flag a useStableCallback prop omitted from effect deps", () => {
    const code = `
      function useAppLayout({ onToggle }) {
        const onNavigationToggle = useStableCallback(onToggle);
        useEffect(() => {
          onNavigationToggle(false);
        }, []);
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).not.toContain("onNavigationToggle");
  });

  // `useCallback(fn, [])` returns the same function forever — omitting
  // it from another hook's deps cannot produce a stale value. Staleness
  // inside the frozen closure is reported at its own definition.
  it("does not flag a useCallback with empty deps omitted from effect deps", () => {
    const code = `
      function CustomSelect({ open, portal }) {
        const buttonRef = useRef(null);
        const [position, setPosition] = useState(null);
        const updatePosition = useCallback(() => {
          if (!buttonRef.current) return;
          setPosition(buttonRef.current.getBoundingClientRect());
        }, []);
        useEffect(() => {
          if (!portal) return;
          if (open) updatePosition();
        }, [open, portal]);
        return position;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).not.toContain("updatePosition");
  });

  it("still flags a useCallback with reactive deps omitted from effect deps", () => {
    const code = `
      function MyComponent({ query }) {
        const search = useCallback(() => {
          fetch(query);
        }, [query]);
        useEffect(() => {
          search();
        }, []);
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("search");
  });

  it("does not flag a useCallback whose deps are all stable omitted from effect deps", () => {
    const code = `
      function Legend({ items }) {
        const [filterMode, setFilterMode] = useState(false);
        const onExitFilterMode = useCallback(() => {
          setFilterMode(false);
        }, [setFilterMode]);
        useEffect(() => {
          onExitFilterMode();
        }, [items]);
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).not.toContain("onExitFilterMode");
  });

  // A module-scope value listed in deps AND read by the callback is
  // redundant (it never changes), but the report must not claim the
  // callback "never uses it".
  it("describes a used module-scope dep accurately instead of claiming it is unused", () => {
    const code = `
      import { navigate } from './router';
      function MyComponent({ id }) {
        const handleNewConversation = useCallback(() => {
          navigate('/conversations/' + id);
        }, [id, navigate]);
        return handleNewConversation;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).not.toContain("never uses it");
    expect(messages).toContain("defined outside the component");
  });

  it("still claims unused for a dep the callback genuinely never reads", () => {
    const code = `
      function MyComponent({ label, unusedProp }) {
        const format = useCallback(() => {
          return label.trim();
        }, [label, unusedProp]);
        return format;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("never uses it");
  });

  // Reusable hooks that mirror useEffect's API forward the caller's
  // deps list (a DependencyList parameter) straight through — the
  // caller owns that array, so there is nothing to statically verify.
  it("does not flag a deps list forwarded from a function parameter", () => {
    const code = `
      function useDebounceEffect(effect, deps, delay) {
        const effectRef = useRef(effect);
        effectRef.current = effect;
        useEffect(() => {
          const timeout = setTimeout(() => effectRef.current(), delay);
          return () => clearTimeout(timeout);
        }, deps);
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).not.toContain("isn't an inline array");
  });

  it("still flags a non-array deps list built from a local variable", () => {
    const code = `
      function MyComponent() {
        const dependencies = [];
        useEffect(() => {}, dependencies);
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("isn't an inline array");
  });

  it("does not flag a spread of a caller-supplied deps parameter", () => {
    const code = `
      function useClientSliceInfiniteScroll({ pageSize }, resetDeps) {
        const [visibleCount, setVisibleCount] = useState(pageSize);
        useEffect(() => {
          setVisibleCount(pageSize);
        }, [pageSize, ...resetDeps]);
        return visibleCount;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).not.toContain("A spread");
  });

  it("still flags a spread of a local array in deps", () => {
    const code = `
      function MyComponent() {
        const local = {};
        const dependencies = [local];
        useEffect(() => {
          console.log(local);
        }, [...dependencies]);
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("A spread");
  });

  // A module-scope callback (usually an import) cannot close over
  // render-scoped values, so passing it by name is safe.
  it("does not flag a module-scope imported function passed as the callback", () => {
    const code = `
      import { subscribeCommands } from './commands';
      function Builder() {
        useEffect(subscribeCommands, []);
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a prop function passed as the callback", () => {
    const code = `
      function MyComponent({ myEffect }) {
        useEffect(myEffect, []);
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("defined elsewhere");
  });

  // A ref seeded with a real value is a mutable data cell, not a handle to
  // a React-rendered DOM node — the "wrong node" cleanup warning doesn't apply.
  it("does not flag cleanup reads of a ref seeded with a data value", () => {
    const code = `
      function TabBar() {
        const timeouts = useRef(new Set());
        useEffect(() => {
          return () => {
            for (const timeoutId of timeouts.current) clearTimeout(timeoutId);
            timeouts.current.clear();
          };
        }, []);
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).not.toContain("cleanup");
  });

  it("does not flag cleanup mutation of a counter ref via ++/--", () => {
    const code = `
      function InternalButton({ loading, loadingButtonCount }) {
        useEffect(() => {
          if (loading) {
            loadingButtonCount.current++;
            return () => {
              loadingButtonCount.current--;
            };
          }
        }, [loading, loadingButtonCount]);
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).not.toContain("cleanup");
  });

  it("still flags cleanup reads of an unseeded DOM ref", () => {
    const code = `
      function MyComponent() {
        const myRef = useRef();
        useEffect(() => {
          const handleMove = () => {};
          myRef.current.addEventListener('mousemove', handleMove);
          return () => myRef.current.removeEventListener('mousemove', handleMove);
        }, []);
        return <div ref={myRef} />;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("cleanup");
  });

  it("still flags cleanup reads of a ref seeded with null", () => {
    const code = `
      function MyComponent() {
        const myRef = useRef(null);
        useEffect(() => {
          const handleMove = () => {};
          myRef.current.addEventListener('mousemove', handleMove);
          return () => myRef.current.removeEventListener('mousemove', handleMove);
        }, []);
        return <div ref={myRef} />;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("cleanup");
  });

  // aws graph-explorer useTabular: the useMemo callback lives inside a
  // nested custom hook (`useControlledState` inside `useTabular`) and
  // reads `selectedRowIds` from the OUTER hook's parameters. The capture
  // walk excludes outer-function bindings from the required-deps diff,
  // but the callback demonstrably reads the value — reporting the
  // declared dep as "never uses it" was factually wrong.
  it("does not claim a dep read from an enclosing hook's scope is never used", () => {
    const code = `
      function useTabular({ selectedRowIds }) {
        const useControlledState = (tableState) => {
          return useMemo(
            () => ({
              ...tableState,
              selectedRowIds: selectedRowIds ?? tableState.selectedRowIds,
            }),
            [tableState, selectedRowIds],
          );
        };
        return useControlledState;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).not.toContain("selectedRowIds");
  });

  // AppFlowy DatabaseTabs: an event-subscription effect listing a
  // useCallback binding it never calls. A memoized callback's identity
  // is a pure artifact of its own deps array, so it cannot be a
  // meaningful re-run trigger — the unused dep only causes needless
  // re-subscription and must be reported.
  it("flags an unused useCallback binding in effect deps (DatabaseTabs corpus shape)", () => {
    const code = `
      function DatabaseTabs({ databasePageId, eventEmitter, loadViewMeta }) {
        const [meta, setMeta] = useState(null);
        const reloadView = useCallback(async () => {
          const view = await loadViewMeta(databasePageId);
          setMeta(view);
        }, [databasePageId, loadViewMeta]);
        useEffect(() => {
          const handleOutlineLoaded = (outline) => {
            setMeta(findView(outline, databasePageId));
          };
          if (eventEmitter) {
            eventEmitter.on('outline_loaded', handleOutlineLoaded);
          }
          return () => {
            if (eventEmitter) {
              eventEmitter.off('outline_loaded', handleOutlineLoaded);
            }
          };
        }, [databasePageId, eventEmitter, reloadView]);
        return meta;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("reloadView");
    expect(messages).toContain("never uses it");
  });

  // Upstream blesses unused reactive deps in effect hooks as intentional
  // re-run triggers (`useEffect(() => scrollTo(0, 0), [activeTab])`), so
  // an unused state value stays exempt (AppFlowy SelectionToolbar shape).
  it("keeps allowing an unused state value in effect deps as a re-run trigger", () => {
    const code = `
      function useToolbar(editor, readOnly) {
        const [visible, setVisible] = useState(false);
        useEffect(() => {
          if (readOnly) return;
          const handleKeyDown = (event) => {
            editor.handle(event);
          };
          const dom = editor.toDOMNode();
          dom.addEventListener('keydown', handleKeyDown);
          return () => {
            dom.removeEventListener('keydown', handleKeyDown);
          };
        }, [editor, readOnly, visible]);
        return { visible, setVisible };
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).not.toContain("visible");
  });

  // Same trigger exemption for custom-hook results (webstudio
  // use-drag-drop shape): unlike useCallback, a custom hook's return
  // identity is not an artifact of a visible deps array, so it can be a
  // deliberate trigger — the rule stays silent.
  it("keeps allowing an unused custom-hook result in effect deps", () => {
    const code = `
      function useDragDrop(dragHandlers, dropHandlers) {
        const autoScrollHandlers = useAutoScroll({ fullscreen: true });
        useLayoutEffect(() => {
          dropHandlers.rootRef(document.documentElement);
          dragHandlers.rootRef(document.documentElement);
          window.addEventListener('scroll', dropHandlers.handleScroll);
          return () => {
            dropHandlers.rootRef(null);
            dragHandlers.rootRef(null);
            window.removeEventListener('scroll', dropHandlers.handleScroll);
          };
        }, [dragHandlers, dropHandlers, autoScrollHandlers]);
        return autoScrollHandlers;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).not.toContain("autoScrollHandlers");
  });

  // evo-web use-key-press: local handlers recreated every render but
  // closing over ONLY useState setters. The stability walk treats such
  // functions as transitively stable — a stale copy behaves identically
  // — so a mount-only effect omitting them stays exempt.
  it("does not require deps for handlers that close over only stable setters (use-key-press corpus shape)", () => {
    const code = `
      const useKeyPress = () => {
        const [arrowUpPressed, setArrowUpPressed] = useState(false);
        const [arrowDownPressed, setArrowDownPressed] = useState(false);
        const upHandler = ({ key }) => {
          const fn = { ArrowUp: setArrowUpPressed, ArrowDown: setArrowDownPressed }[key];
          if (fn) fn(false);
        };
        const downHandler = ({ key }) => {
          const fn = { ArrowUp: setArrowUpPressed, ArrowDown: setArrowDownPressed }[key];
          if (fn) fn(true);
        };
        useEffect(() => {
          window.addEventListener('keydown', downHandler);
          window.addEventListener('keyup', upHandler);
          return () => {
            window.removeEventListener('keydown', downHandler);
            window.removeEventListener('keyup', upHandler);
          };
        }, []);
        return [arrowUpPressed, arrowDownPressed];
      };
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an extra reactive dependency in useCallback", () => {
    const code = `
      function MyComponent({ value, unrelated }) {
        const getValue = useCallback(() => value, [value, unrelated]);
        return getValue;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("unrelated");
  });

  it("ignores a userland function named useCallback", () => {
    const code = `
      const useCallback = (callback, dependencies) => ({ callback, dependencies });
      function Cell({ direct, fallback }) {
        const effectiveCallback = direct ?? fallback;
        return useCallback(() => effectiveCallback?.(), []);
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not report state read only by its sole writer effect's equality guard", () => {
    const code = `
      function Candidate({ source }) {
        const [snapshot, setSnapshot] = useState(source);
        useEffect(() => {
          if (!Object.is(snapshot, source)) setSnapshot(source);
        }, [source]);
        return snapshot;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `if (snapshot !== source) setSnapshot(source);`,
    `if (!Object.is(snapshot, source)) setSnapshot(source);`,
    `if (Object.is(snapshot, source)) return; setSnapshot(source);`,
    `if (snapshot === source) return; setSnapshot(source);`,
    `if (snapshot === source) consume(source); else setSnapshot(source);`,
    `if (Object.is(snapshot, source)) consume(source); else setSnapshot(source);`,
    `if (!!(snapshot !== source)) setSnapshot(source);`,
    `if (ready && snapshot !== source) setSnapshot(source);`,
    `if (!ready || snapshot === source) return; setSnapshot(source);`,
    `const nextSnapshot = source; const aliasedSnapshot = nextSnapshot; if (snapshot !== source) setSnapshot(aliasedSnapshot);`,
    `const nextSnapshot = source; if (snapshot !== nextSnapshot) setSnapshot(source);`,
  ])("accepts a sole-writer state equality guard: %s", (effectBody) => {
    const code = `
      function Candidate({ source }) {
        const [snapshot, setSnapshot] = useState(source);
        useEffect(() => { ${effectBody} }, [source]);
        return snapshot;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a local source derivation used by both the guard and setter", () => {
    const code = `
      function Candidate({ enabled, source }) {
        const [snapshot, setSnapshot] = useState(false);
        useEffect(() => {
          const nextSnapshot = enabled && computeSnapshot(source);
          if (snapshot !== nextSnapshot) setSnapshot(nextSnapshot);
        }, [enabled, source]);
        return snapshot;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `void source; if (!Object.is(snapshot, 0)) setSnapshot(0);`,
    `void source; if (!Object.is(snapshot, NaN)) setSnapshot(NaN);`,
  ])("uses Object.is semantics for exact primitive writes: %s", (effectBody) => {
    const code = `
      function Candidate({ source }) {
        const [snapshot, setSnapshot] = useState(source);
        useEffect(() => { ${effectBody} }, [source]);
        return snapshot;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps a complete sole-writer state dependency valid", () => {
    const code = `
      function Candidate({ source }) {
        const [snapshot, setSnapshot] = useState(source);
        useEffect(() => {
          if (!Object.is(snapshot, source)) setSnapshot(source);
        }, [snapshot, source]);
        return snapshot;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts the same guard in a layout effect through a named hook alias", () => {
    const code = `
      import { useLayoutEffect, useState as useLocalState } from "react";
      function Candidate({ source }) {
        const [snapshot, setSnapshot] = useLocalState(source);
        useLayoutEffect(() => {
          if ((snapshot!) !== source) (setSnapshot)(source);
        }, [source]);
        return snapshot;
      }
    `;
    const result = runRule(exhaustiveDeps, code, { filename: "fixture.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts the same guard through the React namespace", () => {
    const code = `
      import * as React from "react";
      function Candidate({ source }) {
        const [snapshot, setSnapshot] = React.useState(source);
        React.useEffect(() => {
          if (!Object.is(snapshot, source)) setSnapshot(source);
        }, [source]);
        return snapshot;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `useEffect(() => { if (!Object.is(snapshot, source)) setSnapshot(source); }, [source]); return <button onClick={() => setSnapshot("external")}>{snapshot}</button>;`,
    `useEffect(() => { if (!Object.is(snapshot, source)) setSnapshot(source); }, [source]); useEffect(() => { setSnapshot("external"); }, []); return snapshot;`,
    `useEffect(() => { if (!Object.is(snapshot, source)) setSnapshot(source); }, [source]); const update = setSnapshot; return <button onClick={() => update("external")}>{snapshot}</button>;`,
    `useEffect(() => { const update = () => setSnapshot(source); if (!Object.is(snapshot, source)) update(); }, [source]); return snapshot;`,
    `useEffect(() => { if (!Object.is(snapshot, source)) { setSnapshot(source); setSnapshot(source); } }, [source]); return snapshot;`,
    `useEffect(() => { if (!Object.is(snapshot, source)) setSnapshot(source); consume(snapshot); }, [source]); return snapshot;`,
    `useEffect(() => { if (!Object.is(snapshot, source)) consume(source); setSnapshot(source); }, [source]); return snapshot;`,
    `const Object = { is: () => false }; useEffect(() => { if (!Object.is(snapshot, source)) setSnapshot(source); }, [source]); return snapshot;`,
    `const equal = () => false; useEffect(() => { if (!equal(snapshot, source)) setSnapshot(source); }, [source]); return snapshot;`,
    `const notEqual = () => true; useEffect(() => { if (notEqual(snapshot, source)) setSnapshot(source); }, [source]); return snapshot;`,
    `const compare = { equal: () => false }; useEffect(() => { if (!compare.equal(snapshot, source)) setSnapshot(source); }, [source]); return snapshot;`,
    `useInsertionEffect(() => { if (!Object.is(snapshot, source)) setSnapshot(source); }, [source]); return snapshot;`,
    `useEffect(() => { if (snapshot.value !== source.value) setSnapshot(source); }, [source]); return snapshot.value;`,
  ])("reports when sole-writer ownership or guard role is not proven: %s", (componentBody) => {
    const code = `
      function Candidate({ source }) {
        const [snapshot, setSnapshot] = useState(source);
        ${componentBody}
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("does not apply the exemption to a userland useState tuple", () => {
    const code = `
      const useState = (value) => [value, consume];
      function Candidate({ source }) {
        const [snapshot, setSnapshot] = useState(source);
        useEffect(() => {
          if (!Object.is(snapshot, source)) setSnapshot(source);
        }, [source]);
        return snapshot;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it.each([
    {
      effectBody: `if (snapshot === source) setSnapshot(Math.random());`,
      dependencies: `[source]`,
    },
    {
      effectBody: `if (snapshot === source) setSnapshot(source);`,
      dependencies: `[source]`,
    },
    {
      effectBody: `if (Object.is(snapshot, source)) setSnapshot(source);`,
      dependencies: `[source]`,
    },
    {
      effectBody: `if (!(snapshot !== source)) setSnapshot(source);`,
      dependencies: `[source]`,
    },
    {
      effectBody: `if (ready || snapshot !== source) setSnapshot(source);`,
      dependencies: `[ready, source]`,
    },
    {
      effectBody: `if (ready && snapshot === source) return; setSnapshot(source);`,
      dependencies: `[ready, source]`,
    },
    {
      effectBody: `if (snapshot !== source) consume(source); else setSnapshot(source);`,
      dependencies: `[source]`,
    },
    {
      effectBody: `if (snapshot !== source) setSnapshot(other);`,
      dependencies: `[source, other]`,
    },
    {
      effectBody: `if (Object.is(snapshot, source)) setSnapshot(other);`,
      dependencies: `[source, other]`,
    },
    {
      effectBody: `if (normalize(snapshot) !== source) setSnapshot(source);`,
      dependencies: `[source]`,
    },
    {
      effectBody: `if (snapshot !== source) setSnapshot(source);`,
      dependencies: `[]`,
    },
    {
      effectBody: `if (snapshot != source) setSnapshot(source);`,
      dependencies: `[source]`,
    },
    {
      effectBody: `if (snapshot !== 0) setSnapshot(-0);`,
      dependencies: `[source]`,
    },
    {
      effectBody: `void source; if (!Object.is(snapshot, 0)) setSnapshot(-0);`,
      dependencies: `[source]`,
    },
    {
      effectBody: `if (snapshot !== NaN) setSnapshot(NaN);`,
      dependencies: `[source]`,
    },
  ])(
    "reports snapshot when the guard/write/source proof fails: $effectBody $dependencies",
    ({ effectBody, dependencies }) => {
      const code = `
        function Candidate({ other, ready, source }) {
          const [snapshot, setSnapshot] = useState(source);
          useEffect(() => { ${effectBody} }, ${dependencies});
          return snapshot;
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("snapshot");
    },
  );

  describe("bounded identity source resolution", () => {
    it("accepts the exact derived callback dependency", () => {
      const code = `
        function Cell({ onMouseDownCell }) {
          const contextCallbacks = useContext(CellCallbacksContext);
          const effectiveOnMouseDownCell =
            onMouseDownCell ?? contextCallbacks.onMouseDownCell;
          return useCallback(
            (event) => effectiveOnMouseDownCell?.(event),
            [effectiveOnMouseDownCell],
          );
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("does not treat a call dependency as the exact derived binding", () => {
      const code = `
        function Cell({ direct, fallback }) {
          const effectiveCallback = direct ?? fallback;
          return useCallback(() => effectiveCallback?.(), [effectiveCallback()]);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("direct, fallback");
    });

    const authenticCellFixtures = [
      [
        "564623E direct-first whole-context callbacks",
        `function Cell({ value, stringify, renderCellContent, onMouseDownCell, onDoubleClickCell, onKeyDownCell }) {
          const contextStringify = useContext(StringifyContext);
          const contextRenderCellContent = useContext(RenderCellContentContext);
          const contextCallbacks = useContext(CellCallbacksContext);
          const stringifyCell = stringify ?? contextStringify;
          const renderContent = renderCellContent ?? contextRenderCellContent;
          const onMouseDown = onMouseDownCell ?? contextCallbacks.onMouseDownCell;
          const onDoubleClick = onDoubleClickCell ?? contextCallbacks.onDoubleClickCell;
          const onKeyDown = onKeyDownCell ?? contextCallbacks.onKeyDownCell;
          useMemo(() => stringifyCell(value), [stringifyCell, value]);
          useMemo(() => renderContent?.({ value, stringify: stringifyCell }), [renderContent, stringifyCell, value]);
          useCallback(() => onMouseDown?.(), [onMouseDown]);
          useCallback(() => onDoubleClick?.(), [onDoubleClick]);
          useCallback(() => onKeyDown?.(), [onKeyDown]);
        }`,
      ],
      [
        "nkHS2Qe context-first whole-context callbacks",
        `function Cell({ value, stringify, renderCellContent, onMouseDownCell, onDoubleClickCell, onKeyDownCell }) {
          const stringifyFromContext = useContext(StringifyContext);
          const renderCellContentFromContext = useContext(RenderCellContentContext);
          const callbacks = useContext(CellCallbacksContext);
          const stringifyFunction = stringify ?? stringifyFromContext;
          const renderCellContentFunction = renderCellContent ?? renderCellContentFromContext;
          const onMouseDown = callbacks.onMouseDownCell ?? onMouseDownCell;
          const onDoubleClick = callbacks.onDoubleClickCell ?? onDoubleClickCell;
          const onKeyDown = callbacks.onKeyDownCell ?? onKeyDownCell;
          useMemo(() => stringifyFunction(value), [stringifyFunction, value]);
          useMemo(() => renderCellContentFunction?.({ value, stringify: stringifyFunction }), [renderCellContentFunction, stringifyFunction, value]);
          useCallback(() => onMouseDown?.(), [onMouseDown]);
          useCallback(() => onDoubleClick?.(), [onDoubleClick]);
          useCallback(() => onKeyDown?.(), [onKeyDown]);
        }`,
      ],
      [
        "EiAdw4h renamed destructured props",
        `function Cell({ value, stringify: stringifyProp, renderCellContent: renderCellContentProp, onMouseDownCell: onMouseDownCellProp, onDoubleClickCell: onDoubleClickCellProp, onKeyDownCell: onKeyDownCellProp }) {
          const stringifyFromContext = useContext(StringifyContext);
          const renderCellContentFromContext = useContext(RenderCellContentContext);
          const callbacks = useContext(CellCallbacksContext);
          const stringify = stringifyProp ?? stringifyFromContext;
          const renderCellContent = renderCellContentProp ?? renderCellContentFromContext;
          const onMouseDownCell = onMouseDownCellProp ?? callbacks.onMouseDownCell;
          const onDoubleClickCell = onDoubleClickCellProp ?? callbacks.onDoubleClickCell;
          const onKeyDownCell = onKeyDownCellProp ?? callbacks.onKeyDownCell;
          useMemo(() => stringify(value), [stringify, value]);
          useMemo(() => renderCellContent?.({ value, stringify }), [renderCellContent, stringify, value]);
          useCallback(() => onMouseDownCell?.(), [onMouseDownCell]);
          useCallback(() => onDoubleClickCell?.(), [onDoubleClickCell]);
          useCallback(() => onKeyDownCell?.(), [onKeyDownCell]);
        }`,
      ],
      [
        "ERLwxXr destructured context members",
        `function Cell({ value, stringify: directStringify, renderCellContent: directRenderCellContent, onMouseDownCell: directOnMouseDownCell, onDoubleClickCell: directOnDoubleClickCell, onKeyDownCell: directOnKeyDownCell }) {
          const { onMouseDownCell: contextOnMouseDownCell, onDoubleClickCell: contextOnDoubleClickCell, onKeyDownCell: contextOnKeyDownCell } = useContext(CellCallbacksContext);
          const contextStringify = useContext(StringifyContext);
          const contextRenderCellContent = useContext(RenderCellContentContext);
          const stringify = directStringify ?? contextStringify;
          const renderCellContent = directRenderCellContent ?? contextRenderCellContent;
          const onMouseDownCell = directOnMouseDownCell ?? contextOnMouseDownCell;
          const onDoubleClickCell = directOnDoubleClickCell ?? contextOnDoubleClickCell;
          const onKeyDownCell = directOnKeyDownCell ?? contextOnKeyDownCell;
          useMemo(() => stringify(value), [stringify, value]);
          useMemo(() => renderCellContent?.({ value, stringify }), [renderCellContent, stringify, value]);
          useCallback(() => onMouseDownCell?.(), [onMouseDownCell]);
          useCallback(() => onDoubleClickCell?.(), [onDoubleClickCell]);
          useCallback(() => onKeyDownCell?.(), [onKeyDownCell]);
        }`,
      ],
      [
        "wJWmEDA resolved binding names",
        `function Cell({ value, stringify, renderCellContent, onMouseDownCell, onDoubleClickCell, onKeyDownCell }) {
          const contextStringify = useContext(StringifyContext);
          const contextRenderCellContent = useContext(RenderCellContentContext);
          const contextCallbacks = useContext(CellCallbacksContext);
          const resolvedStringify = stringify ?? contextStringify;
          const resolvedRenderCellContent = renderCellContent ?? contextRenderCellContent;
          const resolvedOnMouseDownCell = onMouseDownCell ?? contextCallbacks.onMouseDownCell;
          const resolvedOnDoubleClickCell = onDoubleClickCell ?? contextCallbacks.onDoubleClickCell;
          const resolvedOnKeyDownCell = onKeyDownCell ?? contextCallbacks.onKeyDownCell;
          useMemo(() => resolvedStringify(value), [resolvedStringify, value]);
          useMemo(() => resolvedRenderCellContent?.({ value, stringify: resolvedStringify }), [resolvedRenderCellContent, resolvedStringify, value]);
          useCallback(() => resolvedOnMouseDownCell?.(), [resolvedOnMouseDownCell]);
          useCallback(() => resolvedOnDoubleClickCell?.(), [resolvedOnDoubleClickCell]);
          useCallback(() => resolvedOnKeyDownCell?.(), [resolvedOnKeyDownCell]);
        }`,
      ],
      [
        "359ukck independently named context bindings",
        `function Cell({ value, stringify: stringifyProp, renderCellContent: renderCellContentProp, onMouseDownCell: onMouseDownCellProp, onDoubleClickCell: onDoubleClickCellProp, onKeyDownCell: onKeyDownCellProp }) {
          const stringifyContext = useContext(StringifyContext);
          const renderCellContentContext = useContext(RenderCellContentContext);
          const cellCallbacks = useContext(CellCallbacksContext);
          const stringify = stringifyProp ?? stringifyContext;
          const renderCellContent = renderCellContentProp ?? renderCellContentContext;
          const onMouseDownCell = onMouseDownCellProp ?? cellCallbacks.onMouseDownCell;
          const onDoubleClickCell = onDoubleClickCellProp ?? cellCallbacks.onDoubleClickCell;
          const onKeyDownCell = onKeyDownCellProp ?? cellCallbacks.onKeyDownCell;
          useMemo(() => stringify(value), [stringify, value]);
          useMemo(() => renderCellContent?.({ value, stringify }), [renderCellContent, stringify, value]);
          useCallback(() => onMouseDownCell?.(), [onMouseDownCell]);
          useCallback(() => onDoubleClickCell?.(), [onDoubleClickCell]);
          useCallback(() => onKeyDownCell?.(), [onKeyDownCell]);
        }`,
      ],
    ] as const;

    for (const [fixtureName, code] of authenticCellFixtures) {
      it(`accepts all five exact derived dependencies from ${fixtureName}`, () => {
        const result = runRule(exhaustiveDeps, code);
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toEqual([]);
      });
    }

    it("accepts exact conditional and logical derived dependencies", () => {
      const code = `
        function Cell({ direct, fallback, preferDirect }) {
          const conditionalCallback = preferDirect ? direct : fallback;
          const logicalCallback = direct || fallback;
          useCallback(() => conditionalCallback?.(), [conditionalCallback]);
          useEffect(() => logicalCallback?.(), [logicalCallback]);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("reports an omitted derived dependency", () => {
      const code = `
        function Cell({ direct, fallback }) {
          const effectiveCallback = direct ?? fallback;
          return useCallback(() => effectiveCallback?.(), []);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("direct, fallback");
    });

    it("reports every omitted initializer source when one source is listed", () => {
      const code = `
        function Cell({ direct, fallback }) {
          const effectiveCallback = direct ?? fallback;
          return useCallback(() => effectiveCallback?.(), [direct]);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("fallback");
    });

    it("reports initializer inputs read directly by the hook closure", () => {
      const code = `
        function Cell({ direct, fallback }) {
          const effectiveCallback = direct ?? fallback;
          return useCallback(() => {
            direct?.();
            fallback?.();
          }, [effectiveCallback]);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("direct, fallback");
    });

    it("accepts an exact dependency on a chained const derived binding", () => {
      const code = `
        function Cell({ direct, fallback, override }) {
          const baseCallback = direct ?? fallback;
          const effectiveCallback = override ?? baseCallback;
          return useCallback(() => effectiveCallback?.(), [effectiveCallback]);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("accepts an exact dependency on a reassigned derived binding", () => {
      const code = `
        function Cell({ direct, fallback, override }) {
          let effectiveCallback = direct ?? fallback;
          effectiveCallback = override ?? effectiveCallback;
          return useCallback(() => effectiveCallback?.(), [effectiveCallback]);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("reports an omitted reassigned derived binding", () => {
      const code = `
        function Cell({ direct, fallback, override }) {
          let effectiveCallback = direct ?? fallback;
          effectiveCallback = override ?? effectiveCallback;
          return useCallback(() => effectiveCallback?.(), []);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("effectiveCallback");
    });

    it("still reports an exact derived dependency with a fresh fallback as unstable", () => {
      const code = `
        function Cell({ direct }) {
          const effectiveCallback = direct ?? (() => {});
          return useCallback(() => effectiveCallback(), [effectiveCallback]);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("effectiveCallback");
      expect(messages).toContain("rebuilt every render");
    });

    it("still reports an exact derived dependency with a fresh ternary branch as unstable", () => {
      const code = `
        function Cell({ direct, preferDirect }) {
          const effectiveCallback = preferDirect ? direct : (() => {});
          return useCallback(() => effectiveCallback(), [effectiveCallback]);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("effectiveCallback");
      expect(messages).toContain("rebuilt every render");
    });

    it("does not let a narrower member satisfy an exact derived binding", () => {
      const code = `
        function Cell({ direct, fallback }) {
          const effectiveCallback = direct ?? fallback;
          return useCallback(() => consume(effectiveCallback), [effectiveCallback.current]);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("direct, fallback");
    });

    it("treats an immutable local alias of an imported function as stable", () => {
      const code = `
        import { setConnectionStatus } from "./connection-status";
        function StatusPanel({ status }) {
          const setStatus = setConnectionStatus;
          useEffect(() => {
            setStatus(status);
          }, [status]);
          return null;
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("treats a transitive immutable alias of an imported function as stable", () => {
      const code = `
        import { setConnectionStatus } from "./connection-status";
        function StatusPanel({ status }) {
          const setStatus = setConnectionStatus;
          const updateStatus = (nextStatus) => setStatus(nextStatus);
          useEffect(() => {
            updateStatus(status);
          }, [status]);
          return null;
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("resolves renamed and immutable aliases of React hooks", () => {
      const code = `
        import { useEffect as runEffect, useRef as createRef } from "react";
        function StatusPanel({ status }) {
          const invokeEffect = runEffect as typeof runEffect;
          const statusRef = createRef(status);
          (invokeEffect as typeof invokeEffect)(() => {
            consumeStatus(status, statusRef.current);
          }, []);
          return null;
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("status");
      expect(messages).not.toContain("statusRef");
    });

    it("does not resolve a shadowed React hook import alias", () => {
      const code = `
        import { useMemo as memoize } from "react";
        function StatusPanel({ status }) {
          const run = (memoize) => memoize(() => status, []);
          return run;
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("accepts every reactive identity source of a ref alias with a stable fallback", () => {
      const code = `
        function EditorSurface({ text, pendingMappingOperationsRef }) {
          const noopPendingMappingOperationsRef = useRef([]);
          const pendingOpsRef =
            pendingMappingOperationsRef ?? noopPendingMappingOperationsRef;
          useLayoutEffect(() => {
            consumeOperations(pendingOpsRef.current);
          }, [text, pendingMappingOperationsRef]);
          return null;
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("accepts a stable object ref member as a ref alias fallback", () => {
      const code = `
        function EditorSurface({ pendingMappingOperationsRef }) {
          const fallbackRefs = { operations: useRef([]) };
          const pendingOpsRef = pendingMappingOperationsRef ?? fallbackRefs.operations;
          useLayoutEffect(() => {
            consumeOperations(pendingOpsRef.current);
          }, [pendingMappingOperationsRef]);
          return null;
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("keeps reactive identity sources beside a stable member fallback", () => {
      const code = `
        function EditorSurface({ pendingMappingOperationsRef }) {
          const stableRefs = useMemo(() => ({ operations: null }), []);
          const pendingOpsRef = stableRefs.operations ?? pendingMappingOperationsRef;
          useLayoutEffect(() => {
            consumeOperations(pendingOpsRef.current);
          }, []);
          return null;
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("pendingMappingOperationsRef");
      expect(result.diagnostics[0]?.message).not.toContain("pendingOpsRef");
    });

    it("resolves wrapped optional member identity sources", () => {
      const code = `
        function EditorSurface(props) {
          const fallbackOperationsRef = useRef([]);
          const pendingOpsRef =
            (props?.pendingMappingOperationsRef as React.RefObject<unknown[]>) ??
            fallbackOperationsRef;
          useLayoutEffect(() => {
            consumeOperations(pendingOpsRef.current);
          }, [props.pendingMappingOperationsRef]);
          return null;
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("does not synthesize whole props when declared members cover every props capture", () => {
      const code = `
        function Settings(props) {
          return useMemo(
            () =>
              props.apiKeys.filter(
                (apiKey) => apiKey.organizationId === props.user.organizationId,
              ),
            [props.apiKeys, props.user.organizationId],
          );
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("does not synthesize whole props from a shadowed callback parameter", () => {
      const code = `
        function Settings(props) {
          return useMemo(
            () => [
              props.firstValue,
              props.secondValue,
              ...props.items.map((props) => props.format()),
            ],
            [props.firstValue, props.items],
          );
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("props.secondValue");
      expect(messages).not.toMatch(/dependencies?: `props`(?:,|\.|$)/);
    });

    it("allows an extra reactive useMemo dependency as an invalidation token", () => {
      const code = `
        function Slice({ rows, cacheRevision }) {
          const cacheRef = useRef(new Map());
          return useMemo(
            () => readRows(cacheRef.current, rows),
            [rows, cacheRevision],
          );
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("allows reactive invalidation parameters on a generic useMemo call", () => {
      const code = `
        function usePosition(chart, chartWidth, chartHeight) {
          return useMemo<Position>(
            () => readPosition(chart),
            [chart, chartWidth, chartHeight],
          );
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("flags an unused useMemo dependency derived from a nested fresh fallback", () => {
      const code = `
        function Cell({ direct, other }) {
          const derivedCallback = direct ?? (() => {});
          return useMemo(() => other, [derivedCallback, other]);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("`derivedCallback` changes even though it never uses it");
    });

    it("allows an unused useMemo dependency derived from reactive sources", () => {
      const code = `
        function Cell({ direct, fallback, other }) {
          const derivedCallback = direct ?? fallback;
          return useMemo(() => other, [derivedCallback, other]);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags a fresh useMemo dependency that invalidates every render", () => {
      const code = `
        function Slice({ rows }) {
          const freshInvalidationToken = {};
          return useMemo(
            () => readRows(rows),
            [rows, freshInvalidationToken],
          );
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("freshInvalidationToken");
    });

    it("still flags a stable useMemo dependency that cannot invalidate the memo", () => {
      const code = `
        function Slice({ rows }) {
          const cacheRef = useRef(new Map());
          return useMemo(
            () => readRows(rows),
            [rows, cacheRef],
          );
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("cacheRef");
    });

    it("does not treat a mutable imported-function alias as stable", () => {
      const code = `
        import { setConnectionStatus } from "./connection-status";
        function StatusPanel({ status, overrideStatus }) {
          let setStatus = setConnectionStatus;
          setStatus = overrideStatus ?? setStatus;
          useEffect(() => {
            setStatus(status);
          }, [status]);
          return null;
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("setStatus");
    });

    it("does not treat a render-local closure as an imported-function alias", () => {
      const code = `
        import { setConnectionStatus } from "./connection-status";
        function StatusPanel({ status }) {
          const setStatus = (nextStatus) => setConnectionStatus(nextStatus);
          useEffect(() => {
            setStatus(status);
          }, [status, setStatus]);
          return null;
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("setStatus");
      expect(messages).toContain("rebuilt every render");
    });

    it("does not resolve an alias with a fresh fallback", () => {
      const code = `
        function EditorSurface({ pendingMappingOperationsRef }) {
          const pendingOpsRef = pendingMappingOperationsRef ?? { current: [] };
          useLayoutEffect(() => {
            consumeOperations(pendingOpsRef.current);
          }, [pendingMappingOperationsRef]);
          return null;
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("pendingOpsRef");
    });

    it("reports every missing reactive identity source", () => {
      const code = `
        function EditorSurface({ primaryOperationsRef, secondaryOperationsRef }) {
          const fallbackOperationsRef = useRef([]);
          const pendingOpsRef =
            primaryOperationsRef ?? secondaryOperationsRef ?? fallbackOperationsRef;
          useLayoutEffect(() => {
            consumeOperations(pendingOpsRef.current);
          }, [primaryOperationsRef]);
          return null;
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("secondaryOperationsRef");
      expect(messages).not.toContain("`pendingOpsRef`");
    });

    it("does not resolve computed-member identity sources", () => {
      const code = `
        function EditorSurface({ operationRefs, operationKind }) {
          const fallbackOperationsRef = useRef([]);
          const pendingOpsRef =
            operationRefs[operationKind] ?? fallbackOperationsRef;
          useLayoutEffect(() => {
            consumeOperations(pendingOpsRef.current);
          }, [operationRefs, operationKind]);
          return null;
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("pendingOpsRef");
    });

    it("does not let a narrower member dependency cover an identity source", () => {
      const code = `
        function EditorSurface(props) {
          const fallbackOperationsRef = useRef([]);
          const pendingOpsRef =
            props.pendingMappingOperationsRef ?? fallbackOperationsRef;
          useLayoutEffect(() => {
            consumeOperations(pendingOpsRef.current);
          }, [props.pendingMappingOperationsRef.current]);
          return null;
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("props.pendingMappingOperationsRef");
    });
  });
});

describe("react-builtins/exhaustive-deps — upstream disable-comment suppression", () => {
  const withTempFile = (code: string, run: (filename: string) => void): void => {
    const directory = mkdtempSync(join(tmpdir(), "exhaustive-deps-suppression-"));
    const filename = join(directory, "fixture.tsx");
    writeFileSync(filename, code);
    clearExhaustiveDepsSuppressionCache();
    try {
      run(filename);
    } finally {
      rmSync(directory, { recursive: true, force: true });
      clearExhaustiveDepsSuppressionCache();
    }
  };

  // Codebases migrating from eslint-plugin-react-hooks carry
  // `eslint-disable-next-line react-hooks/exhaustive-deps` on deliberate
  // mount-only effects. The rule's docs direct authors to linter
  // suppressions for intentional exclusions, so the port must honor the
  // upstream rule name (oxlint's disable handling only matches our
  // `react-doctor/exhaustive-deps` id).
  it("honors eslint-disable-next-line react-hooks/exhaustive-deps on the deps line", () => {
    const code = [
      "function MyComponent({ autoStart }) {",
      "  useEffect(() => {",
      "    if (autoStart) start();",
      "    // eslint-disable-next-line react-hooks/exhaustive-deps",
      "  }, []);",
      "}",
    ].join("\n");
    withTempFile(code, (filename) => {
      const result = runRule(exhaustiveDeps, code, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });

  it("honors oxlint-disable-next-line naming exhaustive-deps", () => {
    const code = [
      "function MyComponent({ autoStart }) {",
      "  useEffect(() => {",
      "    if (autoStart) start();",
      "    // oxlint-disable-next-line react-hooks/exhaustive-deps",
      "  }, []);",
      "}",
    ].join("\n");
    withTempFile(code, (filename) => {
      const result = runRule(exhaustiveDeps, code, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });

  it("honors an explicitly annotated session snapshot", () => {
    const code = `
      interface User { role: "user" | "admin" }
      declare const warmupRouteChunks: (role: User["role"], sessionKey: string) => void;

      function IntentionalSessionSnapshot({ sessionKey, user }: { sessionKey: string; user: User }) {
        useEffect(() => {
          const role = user.role;
          warmupRouteChunks(role, sessionKey);
          // eslint-disable-next-line react-hooks/exhaustive-deps -- role is intentionally snapshotted for this session
        }, [sessionKey]);
      }
    `;
    withTempFile(code, (filename) => {
      const result = runRule(exhaustiveDeps, code, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });

  it("retains the syntax-identical unmarked live-role warning", () => {
    const code = `
      interface User { role: "user" | "admin" }
      declare const warmupRouteChunks: (role: User["role"], sessionKey: string) => void;

      function LiveRole({ sessionKey, user }: { sessionKey: string; user: User }) {
        useEffect(() => {
          const role = user.role;
          warmupRouteChunks(role, sessionKey);
        }, [sessionKey]);
      }
    `;
    withTempFile(code, (filename) => {
      const result = runRule(exhaustiveDeps, code, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("user.role");
    });
  });

  it("accepts the explicit session-object encoding", () => {
    const code = `
      interface User { role: "user" | "admin" }
      declare const warmupRouteChunks: (role: User["role"], sessionKey: string) => void;

      function ExplicitSessionSnapshot({ sessionKey, user }: { sessionKey: string; user: User }) {
        const sessionRef = useRef<{ key: string; role: User["role"] } | null>(null);
        if (sessionRef.current?.key !== sessionKey) {
          sessionRef.current = { key: sessionKey, role: user.role };
        }
        const session = sessionRef.current;
        useEffect(() => {
          warmupRouteChunks(session.role, session.key);
        }, [session]);
      }
    `;
    withTempFile(code, (filename) => {
      const result = runRule(exhaustiveDeps, code, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });

  it("ignores disable comments naming a different rule", () => {
    const code = [
      "function MyComponent({ autoStart }) {",
      "  useEffect(() => {",
      "    if (autoStart) start();",
      "    // eslint-disable-next-line no-console",
      "  }, []);",
      "}",
    ].join("\n");
    withTempFile(code, (filename) => {
      const result = runRule(exhaustiveDeps, code, { filename });
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("autoStart");
    });
  });

  // The effect-event dep message only applies to React's own
  // useEffectEvent — a same-named polyfill imported from another package
  // (or spelled through its namespace) returns a STABLE callback, so
  // listing it in deps is correct and must not be reported.
  describe("useEffectEvent dep origin resolution (fuzz FP hunt)", () => {
    it("does not flag a namespace polyfill useEffectEvent listed in deps", () => {
      const code = `
        import { useEffect } from "react";
        import * as FloatingUI from "@floating-ui/react/utils";
        export const TickPanel = ({ value }) => {
          const onTick = FloatingUI.useEffectEvent(() => value);
          useEffect(() => { onTick(); }, [onTick]);
          return null;
        };
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("does not flag a named-import polyfill useEffectEvent listed in deps", () => {
      const code = `
        import { useEffect } from "react";
        import { useEffectEvent } from "@floating-ui/react/utils";
        export const TickPanel = ({ value }) => {
          const onTick = useEffectEvent(() => value);
          useEffect(() => { onTick(); }, [onTick]);
          return null;
        };
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags React's useEffectEvent listed in deps", () => {
      const code = `
        import { useEffect, useEffectEvent } from "react";
        export const TickPanel = ({ value }) => {
          const onTick = useEffectEvent(() => value);
          useEffect(() => { onTick(); }, [onTick]);
          return null;
        };
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("useEffectEvent");
    });

    it("still flags a renamed React useEffectEvent import listed in deps", () => {
      const code = `
        import { useEffect, useEffectEvent as useStableEvent } from "react";
        export const TickPanel = ({ value }) => {
          const onTick = useStableEvent(() => value);
          useEffect(() => { onTick(); }, [onTick]);
          return null;
        };
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("useEffectEvent");
    });

    it("still flags useEffectEvent from a wrapped React namespace listed in deps", () => {
      const code = `
        import React, { useEffect } from "react";
        export const TickPanel = ({ value }) => {
          const onTick = (React as typeof React).useEffectEvent(() => value);
          useEffect(() => { onTick(); }, [onTick]);
          return null;
        };
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("useEffectEvent");
    });

    it("still flags useEffectEvent through an immutable React default-import alias", () => {
      const code = `
        import React, { useEffect } from "react";
        const ReactAlias = React;
        export const TickPanel = ({ value }) => {
          const onTick = ReactAlias.useEffectEvent(() => value);
          useEffect(() => { onTick(); }, [onTick]);
          return null;
        };
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("useEffectEvent");
    });
  });

  describe("render-derived dependency equivalence", () => {
    it("accepts a directly called pure helper derived from the listed dependency", () => {
      const code = `
        import { useMemo } from "react";
        const BREAK_POINTS = { md: "768px" };
        function Sidebar({ breakPoint }) {
          const getBreakpointValue = () => {
            if (!breakPoint) return undefined;
            if (breakPoint === "all") return "screen";
            if (breakPoint in BREAK_POINTS) {
              return \`(max-width: \${BREAK_POINTS[breakPoint]})\`;
            }
            return \`(max-width: \${breakPoint})\`;
          };
          return useMemo(() => getBreakpointValue(), [breakPoint]);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("keeps an independently captured helper input reportable", () => {
      const code = `
        import { useMemo } from "react";
        function Sidebar({ breakPoint, unit }) {
          const getBreakpointValue = () => \`(max-width: \${breakPoint}\${unit})\`;
          return useMemo(() => getBreakpointValue(), [breakPoint]);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("unit");
    });

    it("keeps a helper passed by identity reportable", () => {
      const code = `
        import { useMemo } from "react";
        function Sidebar({ breakPoint }) {
          const getBreakpointValue = () => String(breakPoint);
          return useMemo(() => register(getBreakpointValue), [breakPoint]);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("getBreakpointValue");
    });

    it("keeps a side-effecting helper reportable", () => {
      const code = `
        import { useMemo } from "react";
        function Sidebar({ breakPoint }) {
          const getBreakpointValue = () => {
            analytics.track(breakPoint);
            return String(breakPoint);
          };
          return useMemo(() => getBreakpointValue(), [breakPoint]);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("getBreakpointValue");
    });

    it("accepts a conditionally assigned local derived from the listed dependency", () => {
      const code = `
        import { useEffect, useState } from "react";
        function Image({ value, thingError }) {
          let valueError;
          if (!value) {
            valueError = new Error("No value found for property.");
          }
          const [, setError] = useState();
          useEffect(() => {
            setError(thingError ?? valueError);
          }, [thingError, value]);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("keeps an independent conditional assignment input reportable", () => {
      const code = `
        import { useEffect, useState } from "react";
        function Image({ value, retryError }) {
          let valueError;
          if (!value) valueError = new Error("No value found for property.");
          if (retryError) valueError = retryError;
          const [, setError] = useState();
          useEffect(() => {
            setError(valueError);
          }, [value]);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("retryError");
    });

    it("keeps nested computed-member inputs reportable", () => {
      const code = `
        import { useEffect } from "react";
        function Picker({ enabled, items, index, consume }) {
          let selectedName;
          if (enabled) selectedName = items[index].name;
          useEffect(() => {
            consume(selectedName);
          }, [enabled, items, consume]);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("selectedName");
    });

    it("keeps destructured source bindings reportable", () => {
      const code = `
        import { useEffect } from "react";
        function Picker({ enabled, record, consume }) {
          const { selectedName } = record;
          let derivedName;
          if (enabled) derivedName = selectedName;
          useEffect(() => {
            consume(derivedName);
          }, [enabled, record, consume]);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("selectedName");
    });

    it("keeps nested mutable-local writes reportable", () => {
      const code = `
        import { useEffect } from "react";
        function Image({ value, setError }) {
          let valueError;
          const updateError = () => {
            if (!value) valueError = new Error("No value found for property.");
          };
          useEffect(() => {
            updateError();
            setError(valueError);
          }, [value]);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it("keeps render-time mutable-local escapes reportable", () => {
      const code = `
        import { useEffect } from "react";
        function Image({ value, retryError, setError }) {
          let valueError;
          if (!value) valueError = new Error("No value found for property.");
          attachRetryError(valueError, retryError);
          useEffect(() => {
            setError(valueError);
          }, [value]);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it("keeps nested render-time mutable-local escapes reportable", () => {
      const code = `
        import { useEffect } from "react";
        function Image({ value, retryError, setError }) {
          let valueError;
          if (!value) valueError = new Error("No value found for property.");
          (() => attachRetryError(valueError, retryError))();
          useEffect(() => {
            setError(valueError);
          }, [value]);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it("keeps mutable initial-state expressions reportable", () => {
      const code = `
        import { useEffect, useState } from "react";
        function Image({ value, retryError, setError }) {
          let valueError;
          if (!value) valueError = new Error("No value found for property.");
          useState((valueError.retry = retryError));
          useEffect(() => {
            setError(valueError);
          }, [value]);
        }
      `;
      const result = runRule(exhaustiveDeps, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });

  it("does not suppress a report on a different line than the disable comment", () => {
    const code = [
      "function MyComponent({ autoStart, other }) {",
      "  // eslint-disable-next-line react-hooks/exhaustive-deps",
      "  const noop = 1;",
      "  useEffect(() => {",
      "    if (autoStart) start(noop, other);",
      "  }, []);",
      "}",
    ].join("\n");
    withTempFile(code, (filename) => {
      const result = runRule(exhaustiveDeps, code, { filename });
      expect(result.parseErrors).toEqual([]);
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
      expect(messages).toContain("autoStart");
    });
  });
});
