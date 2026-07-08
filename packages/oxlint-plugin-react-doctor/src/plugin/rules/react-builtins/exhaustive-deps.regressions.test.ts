import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";
import { clearExhaustiveDepsSuppressionCache } from "./exhaustive-deps-suppression.js";

describe("react-builtins/exhaustive-deps — regressions", () => {
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

  it("still flags a dep the callback truly never reads", () => {
    const code = `
      function MyComponent({ value, unrelated }) {
        const doubled = useMemo(() => value * 2, [value, unrelated]);
        return doubled;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("unrelated");
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
