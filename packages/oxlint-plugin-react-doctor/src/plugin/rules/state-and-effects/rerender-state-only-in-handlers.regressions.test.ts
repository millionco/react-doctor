import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderStateOnlyInHandlers } from "./rerender-state-only-in-handlers.js";

describe("rerender-state-only-in-handlers — regressions", () => {
  it("treats a userland same-name hook as render-phase consumption", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `const useEffect = (value) => useCustomSubscription(value);
      function Widget() {
        const [selected, setSelected] = useState(null);
        useEffect(selected);
        return <button onClick={() => setSelected("primary")}>select</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags self-echo state through a React effect import alias", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `import { useEffect as useSynchronize, useState } from "react";
      function Widget({ value }) {
        const [copied, setCopied] = useState(value);
        useSynchronize(() => {
          if (copied !== value) setCopied(value);
        }, [copied, value]);
        return <button onClick={() => setCopied(null)}>reset</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("copied");
  });

  it("stays silent when state drives a side-effect-only effect through a one-hop derived local", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Widget() {
        const [page, setPage] = useState(1);
        const offset = page * 10;
        useEffect(() => { fetchItems(offset); }, [offset]);
        return <button onClick={() => setPage((p) => p + 1)}>Next</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when state is read during render by a hook call argument", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Chart() {
        const [scrollY, setScrollY] = useState(0);
        const onScroll = () => setScrollY(window.scrollY);
        useChartEngine(scrollY);
        return <div onScroll={onScroll} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on the adjust-state-during-render prev-value guard", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `const RadioGroup = ({ value }) => {
        const [selectedValue, setSelectedValue] = useState(null);
        const [prevValue, setPrevValue] = useState(value);
        if (prevValue !== value) {
          setPrevValue(value);
          setSelectedValue(value ?? null);
        }
        return <div role="radiogroup">{selectedValue}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags write-only state with no effect dependency", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function App() {
        const [logged, setLogged] = useState(false);
        const onClick = () => setLogged(true);
        return <button onClick={onClick}>go</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("logged");
  });

  it("stays silent when an async React handler mutates location in its synchronous prefix", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `import { useState } from "react";
      function AsyncPrefixLocationInvalidator() {
        const [revision, setRevision] = useState(0);
        const navigate = async () => {
          setRevision((previous) => previous + 1);
          history.pushState({}, "", "/next");
          await Promise.resolve();
        };
        return <button onClick={navigate}>{location.pathname}</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a setter evaluated inside a location mutation outside proven React batching", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `import { useState } from "react";
      function NestedSetterLocationMutation() {
        const [revision, setRevision] = useState(0);
        const navigate = () => {
          history.pushState({}, "", String(setRevision((previous) => previous + 1)));
        };
        return <Router onNavigate={navigate}>{location.pathname}</Router>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("revision");
  });

  it("stays silent for the same nested setter inside a proven React event handler", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `import { useState } from "react";
      function BatchedNestedSetterLocationMutation() {
        const [revision, setRevision] = useState(0);
        const navigate = () => {
          history.pushState({}, "", String(setRevision((previous) => previous + 1)));
        };
        return <button onClick={navigate}>{location.pathname}</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    {
      hookName: "useEffect",
      mutationBody: `setRevision((previous) => previous + 1);
        history.pushState({}, "", "/next");`,
    },
    {
      hookName: "useLayoutEffect",
      mutationBody:
        'history.replaceState({}, "", String(setRevision((previous) => previous + 1)));',
    },
  ])(
    "stays silent when $hookName batches a setter before a location mutation",
    ({ hookName, mutationBody }) => {
      const result = runRule(
        rerenderStateOnlyInHandlers,
        `import { ${hookName}, useState } from "react";
        function EffectLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          ${hookName}(() => {
            ${mutationBody}
          }, []);
          return <output>{location.pathname}</output>;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each([
    {
      name: "the location mutation follows an await",
      body: `setRevision((previous) => previous + 1);
        await Promise.resolve();
        history.pushState({}, "", "/next");`,
    },
    {
      name: "an await precedes both the setter and location mutation",
      body: `await Promise.resolve();
        setRevision((previous) => previous + 1);
        history.pushState({}, "", "/next");`,
    },
    {
      name: "the location mutation awaits one of its arguments",
      body: `setRevision((previous) => previous + 1);
        history.pushState({}, "", await Promise.resolve("/next"));`,
    },
  ])("still flags write-only state when $name", ({ body }) => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `import { useState } from "react";
      function PostSuspensionLocationInvalidator() {
        const [revision, setRevision] = useState(0);
        const navigate = async () => {
          ${body}
        };
        return <button onClick={navigate}>{location.pathname}</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("revision");
  });

  it("stays silent when final sequence JSX escapes after its setter alias initializes", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `import { useState } from "react";
      function SequenceStoredInlineHandlerLocationInvalidator() {
        const [revision, setRevision] = useState(0);
        const element = (trackCreation(), <button onClick={() => {
          history.pushState({}, "", "/next");
          bump((previous) => previous + 1);
        }}>Go</button>);
        const bump = setRevision;
        const reset = () => setRevision(0);
        return <>{element}<button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a nested final sequence aggregate escapes after alias initialization", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `import { useState } from "react";
      function NestedSequenceAggregateLocationInvalidator() {
        const [revision, setRevision] = useState(0);
        const elements = (trackOuter(), (trackInner(), [<button onClick={() => {
          history.pushState({}, "", "/next");
          bump((previous) => previous + 1);
        }}>Go</button>]));
        const bump = setRevision;
        const reset = () => setRevision(0);
        return <>{elements}<button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    {
      name: "the JSX is not the final sequence value",
      declaration: `const element = (<button onClick={() => {
          history.pushState({}, "", "/next");
          bump((previous) => previous + 1);
        }}>Go</button>, <span>Done</span>);`,
      beforeAlias: "",
    },
    {
      name: "the final sequence value escapes before alias initialization",
      declaration: `const element = (trackCreation(), <button onClick={() => {
          history.pushState({}, "", "/next");
          bump((previous) => previous + 1);
        }}>Go</button>);`,
      beforeAlias: "registerElement(element);",
    },
    {
      name: "the final sequence aggregate is mutable",
      declaration: `let element = (trackCreation(), <button onClick={() => {
          history.pushState({}, "", "/next");
          bump((previous) => previous + 1);
        }}>Go</button>);`,
      beforeAlias: "element = <span>Replaced</span>;",
    },
  ])("still flags write-only state when $name", ({ beforeAlias, declaration }) => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `import { useState } from "react";
      function UnprovenSequenceStoredInlineHandlerLocationInvalidator() {
        const [revision, setRevision] = useState(0);
        ${declaration}
        ${beforeAlias}
        const bump = setRevision;
        const reset = () => setRevision(0);
        return <>{element}<button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("revision");
  });

  // bem-yandex/ui drawer content: `closing` is
  // never rendered — the effect that lists it in deps self-resets it, so the
  // dep mention must not exempt it.
  it("flags handler-set state whose only effect self-resets it (bem-yandex drawer)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `const DrawerContent = ({ visible, springValue, onClose, onCloseEnd }) => {
        const [closing, setClosing] = useState(false);
        useEffect(() => {
          if (closing && springValue === 0) {
            onCloseEnd();
            setClosing(false);
          }
        }, [closing, springValue, onCloseEnd]);
        const handleClose = useCallback(() => {
          setClosing(true);
          onClose();
        }, [onClose]);
        return <div onClick={handleClose}>{visible ? springValue : null}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("closing");
  });

  // jumpinjackie/mapguide-react-layout task pane:
  // `invalidated` only feeds an effect that rewrites it from props — echoing
  // it in that effect's deps must not exempt it.
  it("flags never-rendered state rewritten by its own dep-listing effect (mapguide task pane)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function TaskPane({ currentUrl, mapName, locale, onUrlLoaded }) {
        const [invalidated, setInvalidated] = React.useState(false);
        const [frameContentLoaded, setFrameContentLoaded] = React.useState(false);
        const handleFrameLoaded = React.useCallback((e) => {
          setFrameContentLoaded(true);
          onUrlLoaded(e.currentTarget.contentWindow.location.href);
        }, [onUrlLoaded]);
        React.useEffect(() => {
          if (!invalidated && currentUrl && currentUrlDoesNotMatchMapName(currentUrl, mapName)) {
            setInvalidated(true);
          } else if (invalidated && currentUrl && !currentUrlDoesNotMatchMapName(currentUrl, mapName)) {
            setInvalidated(false);
          }
        }, [currentUrl, mapName, invalidated]);
        return (
          <div>
            <iframe name="taskPaneFrame" onLoad={handleFrameLoaded} />
            {frameContentLoaded === false ? <TaskFrameLoadingOverlay locale={locale} /> : null}
          </div>
        );
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("invalidated");
  });

  // sofn-xyz/mailing settings: `apiKeys` feeds a derived-state chain effect
  // whose output (`apiKeyRows`) IS rendered, so its updates do change the
  // screen — a ref would stop the chain (verified FP in the large-scale run;
  // the derived-state chain itself is no-derived-state-effect territory).
  it("stays silent on state consumed by a derived-state chain effect whose output renders (sofn settings)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Settings(props) {
        const [apiKeys, setApiKeys] = useState(props.apiKeys);
        const [apiKeyRows, setApiKeyRows] = useState([]);
        const createApiKey = useCallback(async () => {
          const response = await fetch("/api/apiKeys", { method: "POST" });
          const json = await response.json();
          setApiKeys(apiKeys.concat(json.apiKey));
        }, [apiKeys]);
        useEffect(() => {
          setApiKeyRows(
            apiKeys.map((apiKey) => [apiKey.id, JSON.stringify(apiKey.active)]),
          );
        }, [apiKeys]);
        return (
          <div>
            <OutlineButton onClick={createApiKey} text="New API Key" />
            <Table rows={apiKeyRows} />
          </div>
        );
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // wangeditor-next editor: the
  // creation effect that lists `editor` in deps also writes it, so the
  // side-effect-only effects listing it too must not rescue it.
  it("flags never-rendered state when any dep-listing effect writes it (wangeditor editor)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function EditorComponent({ value, defaultConfig, onChange, mode }) {
        const ref = useRef(null);
        const latestHtmlRef = useRef(null);
        const [editor, setEditor] = useState(null);
        const handleDestroyed = useCallback(() => {
          setEditor(null);
        }, []);
        useEffect(() => {
          if (editor == null) return;
          editor.__react_on_change = (e) => {
            latestHtmlRef.current = e.getHtml();
            if (onChange) onChange(e);
          };
          return () => {
            editor.__react_on_change = undefined;
          };
        }, [editor, defaultConfig, onChange]);
        useEffect(() => {
          if (editor == null) return;
          if (value === latestHtmlRef.current) return;
          editor.setHtml(value);
          latestHtmlRef.current = editor.getHtml();
        }, [editor, value]);
        useEffect(() => {
          if (ref.current == null) return;
          if (editor != null) return;
          const newEditor = createEditor({
            selector: ref.current,
            config: { ...defaultConfig, onDestroyed: handleDestroyed },
            mode,
          });
          latestHtmlRef.current = newEditor.getHtml();
          setEditor(newEditor);
        }, [editor, defaultConfig, handleDestroyed, mode, value]);
        return <div ref={ref} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("editor");
  });

  it("stays silent when state is a pure effect re-run trigger the effect never reads (ant-design AffixTabs)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `const AffixTabs = () => {
        const idsRef = React.useRef([]);
        const [loaded, setLoaded] = React.useState(false);
        React.useEffect(() => {
          idsRef.current = Array.from(document.querySelectorAll('h2[id]')).map(({ id }) => id);
          setLoaded(true);
        }, []);
        React.useEffect(() => {
          const hashId = decodeURIComponent((location.hash || '').slice(1));
          if (hashId) scrollToId(hashId);
        }, [loaded]);
        return <div>tabs</div>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on the adjust-state-during-render prev-value guard (brainly RadioGroup)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function RadioGroup({ value }) {
        const [prevValue, setPrevValue] = useState(value);
        const [internalValue, setInternalValue] = useState(value);
        if (value !== prevValue) {
          setPrevValue(value);
          setInternalValue(value);
        }
        const onChange = (next) => setInternalValue(next);
        return <div onClick={() => onChange(value)}>{internalValue}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("rerender-state-only-in-handlers — consume-then-clear and hook-argument regressions", () => {
  // nexu HomeView pendingPluginUseHandoff / psysonic pendingFocusTitle:
  // the effect consumes the state's PAYLOAD (member reads, call arguments)
  // before clearing it — a handoff, not a self-echo. The re-render is the
  // delivery mechanism; a ref would never trigger the consume.
  it("stays silent on a pending payload consumed by an effect that then clears it", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function HomeView({ plugins }) {
        const [pendingHandoff, setPendingHandoff] = useState(null);
        useEffect(() => {
          if (!pendingHandoff) return;
          const record = plugins.find((plugin) => plugin.id === pendingHandoff.pluginId);
          setPendingHandoff(null);
          if (record) routePluginUse(record, pendingHandoff.action);
        }, [pendingHandoff, plugins]);
        return <button onClick={() => setPendingHandoff({ pluginId: 'a', action: 'run' })}>go</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a focus target consumed as a call argument then cleared", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Settings() {
        const [pendingFocusTitle, setPendingFocusTitle] = useState(null);
        useEffect(() => {
          if (!pendingFocusTitle) return;
          const el = document.querySelector(\`[data-title="\${CSS.escape(pendingFocusTitle)}"]\`);
          if (el) el.scrollIntoView();
          setPendingFocusTitle(null);
        }, [pendingFocusTitle]);
        return <input onKeyDown={() => setPendingFocusTitle('general')} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // psysonic ContextMenu: state handed to a custom hook is consumed by
  // foreign reactive logic on every render.
  it("stays silent on state passed as an argument to a custom hook", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function ContextMenu() {
        const [pendingSubmenuKeyboardFocus, setPendingSubmenuKeyboardFocus] = useState(false);
        useContextMenuKeyboardNav({ pendingSubmenuKeyboardFocus, setPendingSubmenuKeyboardFocus });
        return <div onKeyDown={() => setPendingSubmenuKeyboardFocus(true)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

// Must-detect anchors: never-rendered state whose dep-listing effect also
// writes it back synchronously (self-echo loop). The effect's re-runs are
// driven by its OTHER deps, so a ref (or no state at all) would work — the
// state-triggered re-render really is wasted.
describe("rerender-state-only-in-handlers — must-detect anchors (self-echo effect state, never rendered)", () => {
  it("flags `closing` set in a handler and consumed only by an effect (bem-yandex DrawerContent)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `const DrawerContent = ({ springValue, onCloseEnd, onClose, children }) => {
        const contentRef = useRef(null);
        const [closing, setClosing] = useState(false);
        useEffect(() => {
          if (closing && springValue === 0) {
            onCloseEnd();
            setClosing(false);
          }
        }, [closing, springValue, onCloseEnd]);
        const _onClose = useCallback(() => {
          setClosing(true);
          onClose();
        }, [onClose]);
        return <div ref={contentRef} onClick={_onClose}>{children}</div>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("closing");
  });

  // The consuming effect never writes `emojiData`; as a ref the async fetch
  // landing would not re-run it and onDataChange would never fire — the
  // re-render is the delivery mechanism (verified FP in the large-scale run).
  it("stays silent on `emojiData` set by one effect and read reactively by another (frimousse emoji-picker)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function EmojiPickerDataHandler({ emojiVersion, emojibaseUrl }) {
        const [emojiData, setEmojiData] = useState(undefined);
        const store = useEmojiPickerStore();
        const locale = useSelectorKey(store, "locale");
        const columns = useSelectorKey(store, "columns");
        const skinTone = useSelectorKey(store, "skinTone");
        const search = useSelectorKey(store, "search");
        useEffect(() => {
          const controller = new AbortController();
          getEmojiData({ locale, emojiVersion, emojibaseUrl, signal: controller.signal })
            .then((data) => setEmojiData(data))
            .catch(() => {});
          return () => controller.abort();
        }, [emojiVersion, emojibaseUrl, locale]);
        useEffect(() => {
          if (!emojiData) return;
          return requestIdleCallback(() => {
            store.get().onDataChange(getEmojiPickerData(emojiData, columns, skinTone, search));
          }, { timeout: 100 });
        }, [emojiData, columns, skinTone, search]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags `editor` state only read inside effects (wangeditor Editor)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function EditorComponent({ defaultConfig, onChange, value }) {
        const [editor, setEditor] = useState(null);
        const ref = useRef(null);
        useEffect(() => {
          if (editor != null) return;
          const newEditor = createEditor({ selector: ref.current, config: { ...defaultConfig, onChange } });
          setEditor(newEditor);
        }, [editor, defaultConfig, onChange]);
        useEffect(() => {
          if (editor == null) return;
          editor.setHtml(value);
        }, [editor, value]);
        return <div ref={ref} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("editor");
  });

  it("flags `invalidated` read only in an effect + its deps (mapguide TaskPane)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `export const TaskPane = ({ currentUrl, mapName, locale, onUrlLoaded }) => {
        const [invalidated, setInvalidated] = React.useState(false);
        const [frameContentLoaded, setFrameContentLoaded] = React.useState(false);
        const handleFrameLoaded = React.useCallback((e) => {
          setFrameContentLoaded(true);
          onUrlLoaded(e.currentTarget.contentWindow.location.href);
        }, [onUrlLoaded]);
        React.useEffect(() => {
          if (!invalidated && currentUrl && currentUrlDoesNotMatchMapName(currentUrl, mapName)) {
            setInvalidated(true);
          } else if (invalidated && currentUrl && !currentUrlDoesNotMatchMapName(currentUrl, mapName)) {
            setInvalidated(false);
          }
        }, [currentUrl, mapName, invalidated]);
        return (
          <div>
            {(() => {
              const components = [<iframe key="f" onLoad={handleFrameLoaded} />];
              if (frameContentLoaded === false) {
                components.push(<span key="o">{locale}</span>);
              }
              return components;
            })()}
          </div>
        );
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("invalidated");
  });

  // The chain output (`apiKeyRows`) renders, so `apiKeys` updates reach the
  // screen through the effect — verified FP in the large-scale run.
  it("stays silent on `apiKeys` feeding a rendered derived-state chain (sofn-xyz mailing settings)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Settings(props) {
        const [apiKeys, setApiKeys] = useState(props.apiKeys);
        const [apiKeyRows, setApiKeyRows] = useState([]);
        const createApiKey = useCallback(async () => {
          const response = await fetch("/api/apiKeys", { method: "POST" });
          const json = await response.json();
          setApiKeys(apiKeys.concat(json.apiKey));
        }, [apiKeys]);
        useEffect(() => {
          setApiKeyRows(apiKeys.map((apiKey) => [apiKey.id, JSON.stringify(apiKey.active)]));
        }, [apiKeys]);
        return <div onClick={createApiKey}>{apiKeyRows.length}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

// FP clusters from the 67k-diagnostic verification run: state consumed
// reactively by effects, and render reads the reachability analysis missed.
describe("rerender-state-only-in-handlers — verified FP regressions", () => {
  it("stays silent when an effect reads the state to attach listeners (cloudscape ResizableBox)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function ResizableBox({ onResize, children }) {
        const [dragOffset, setDragOffset] = useState(null);
        const onMouseDown = (event) => setDragOffset({ x: event.clientX, y: event.clientY });
        useEffect(() => {
          if (!dragOffset) return;
          const onMove = (event) => onResize(event.clientX - dragOffset.x, event.clientY - dragOffset.y);
          const onUp = () => setDragOffset(null);
          document.addEventListener("pointermove", onMove);
          document.addEventListener("pointerup", onUp);
          return () => {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
          };
        }, [dragOffset, onResize]);
        return <div onMouseDown={onMouseDown}>{children}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an async self-write retry loop (webstudio Logout)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `const Logout = (props) => {
        const [logoutState, setLogoutState] = useState({ retries: 3, logoutUrls: props.logoutUrls });
        useEffect(() => {
          if (logoutState.retries === 0) {
            props.onFinish(logoutState.logoutUrls);
            return;
          }
          Promise.allSettled(logoutState.logoutUrls.map((url) => fetch(url, { method: "POST" }))).then(
            (results) => {
              const failedUrls = logoutState.logoutUrls.filter((url, index) => results[index].status === "rejected");
              if (failedUrls.length === 0) {
                props.onFinish();
                return;
              }
              setLogoutState({ retries: logoutState.retries - 1, logoutUrls: failedUrls });
            },
          );
        }, [logoutState, props]);
        return <Text>Logging out ...</Text>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when state is written into a rendered style object (ant-design WaveEffect)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `const WaveEffect = ({ target, colorSource }) => {
        const [waveColor, setWaveColor] = useState(null);
        const waveStyle = { position: "absolute" };
        if (waveColor) {
          waveStyle["--wave-color"] = waveColor;
        }
        function syncPos() {
          setWaveColor(getTargetWaveColor(target, colorSource));
        }
        return <div style={waveStyle} onTransitionEnd={syncPos} />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when state is pushed into a rendered array (mapguide SplitterLayout)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `const SplitterLayout = (props) => {
        const [secondaryPaneSize, setSecondaryPaneSize] = useState(0);
        const onMouseUp = () => setSecondaryPaneSize(computePaneSize());
        const wrappedChildren = [];
        for (let index = 0; index < props.children.length; ++index) {
          let size = null;
          if (index !== 0) {
            size = secondaryPaneSize;
          }
          wrappedChildren.push(<Pane size={size} key={index}>{props.children[index]}</Pane>);
        }
        return <div onMouseUp={onMouseUp}>{wrappedChildren}</div>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when state picks the rendered component via a local JSX name (tracecat CopyButton)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `const CodeBlockCopyButton = ({ onCopy }) => {
        const [isCopied, setIsCopied] = useState(false);
        const copyToClipboard = () => {
          setIsCopied(true);
          onCopy();
        };
        const Icon = isCopied ? CheckIcon : CopyIcon;
        return (
          <Button onClick={copyToClipboard}>
            <Icon size={14} />
          </Button>
        );
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when state selects between handlers in a JSX attribute (internxt DriveExplorer)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `const DriveExplorer = ({ children }) => {
        const [isListElementsHovered, setIsListElementsHovered] = useState(false);
        const handleContextMenuClick = (event) => {
          event.preventDefault();
          openContextMenu(event);
        };
        return (
          <div
            onContextMenu={isListElementsHovered ? undefined : handleContextMenuClick}
            onMouseEnter={() => setIsListElementsHovered(true)}
            onMouseLeave={() => setIsListElementsHovered(false)}
          >
            {children}
          </div>
        );
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags `void state` hygiene when the render output is static (scroll tracker)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function ScrollTracker() {
        const [scrollY, setScrollY] = useState(0);
        void scrollY;
        useEffect(() => {
          const onScroll = () => setScrollY(window.scrollY);
          window.addEventListener("scroll", onScroll, { passive: true });
          return () => window.removeEventListener("scroll", onScroll);
        }, []);
        return <div>tracking</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("scrollY");
  });

  it("still flags a shadowed block-local `void` read of state (dead derived local)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `const ShadowedBlockLocal = ({ enabled }) => {
        const [view, setView] = useState("login");
        if (enabled) {
          const label = view === "login" ? "Log in" : "Create account";
          void label;
        }
        const label = "Continue";
        return <button onClick={() => setView("signup")}>{label}</button>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("view");
  });

  it("stays silent on the `void state` render-read marker (openflipbook WaterfallHUD)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function WaterfallHUD() {
        const [now, setNow] = useState(0);
        useEffect(() => {
          const timer = setInterval(() => setNow(performance.now()), 100);
          return () => clearInterval(timer);
        }, []);
        const segments = buildSegments(performance.now());
        void now;
        return <div>{segments.length}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // portos VideoGen (delta audit): `runningQueueId` marks the busy slot of an
  // effect-driven dequeue loop. The effect guards on it, claims it
  // synchronously, and releases it from async continuations (`.finally`, a
  // BUSY-retry timer) — each release re-renders and re-runs the effect to
  // dispatch the next queued item. A ref would freeze the queue.
  it("stays silent on an async dequeue loop whose setter is also cleared from nested callbacks (portos VideoGen)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function VideoGen() {
        const [queue, setQueue] = useState([]);
        const [generating, setGenerating] = useState(false);
        const [runningQueueId, setRunningQueueId] = useState(null);
        useEffect(() => {
          if (generating || runningQueueId) return;
          const next = queue.find((item) => item.status === 'pending');
          if (!next) return;
          setRunningQueueId(next.id);
          setQueue((q) => q.map((item) => item.id === next.id ? { ...item, status: 'running' } : item));
          let busyRetry = false;
          let busyRetryTimer = null;
          runGeneration(next.params).then((res) => {
            setQueue((q) => q.map((item) => item.id === next.id ? { ...item, status: 'complete', result: res } : item));
          }).catch((err) => {
            if (isBusyError(err)) {
              busyRetry = true;
              busyRetryTimer = setTimeout(() => setRunningQueueId((curr) => (curr === next.id ? null : curr)), 1500);
              return;
            }
            setQueue((q) => q.map((item) => item.id === next.id ? { ...item, status: 'error' } : item));
          }).finally(() => {
            if (!busyRetry) setRunningQueueId(null);
          });
          return () => { if (busyRetryTimer) clearTimeout(busyRetryTimer); };
        }, [queue, generating, runningQueueId]);
        return <div>{queue.length} queued{generating ? ' (generating)' : ''}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // lumina-note PDFThumbnails (delta audit recall regression): visibleRange
  // is never rendered; its only reads are \`currentPage < visibleRange.start\`
  // comparisons inside the guard of the very effect that sets it. A guard
  // read is not payload consumption — the self-echo must stay flagged.
  it("still flags state whose member reads live only in its own effect's guard tests (lumina PDFThumbnails)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function PDFThumbnails({ numPages, currentPage, onPageClick }) {
        const [visibleRange, setVisibleRange] = useState({ start: 1, end: 10 });
        useEffect(() => {
          if (currentPage < visibleRange.start) {
            setVisibleRange({
              start: Math.max(1, currentPage - 2),
              end: Math.min(numPages, currentPage + 7),
            });
          } else if (currentPage > visibleRange.end) {
            setVisibleRange({
              start: Math.max(1, currentPage - 7),
              end: Math.min(numPages, currentPage + 2),
            });
          }
        }, [currentPage, numPages, visibleRange]);
        return (
          <div>
            {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
              <div key={pageNum} onClick={() => onPageClick(pageNum)}>{pageNum}</div>
            ))}
          </div>
        );
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("visibleRange");
  });

  it("stays silent when the effect consumes the payload outside its guard even with a sync self-write", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function HandoffPane({ plugins }) {
        const [pendingHandoff, setPendingHandoff] = useState(null);
        useEffect(() => {
          if (!pendingHandoff) return;
          routePluginUse(pendingHandoff.pluginId, pendingHandoff.action);
          setPendingHandoff(null);
        }, [pendingHandoff, plugins]);
        return <button onClick={() => setPendingHandoff({ pluginId: 'a', action: 'run' })}>go</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when reads inside a rendered nested component consume the state (innovaccer StoryComp)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `const StoryComp = ({ onClick }) => {
        const [isTooltipActive, setTooltipActive] = useState(false);
        const copyToClipboard = () => setTooltipActive(true);
        const CopyCode = (props) => (
          <Tooltip open={isTooltipActive} position="bottom">
            <Icon name="content_copy" onClick={props.onClick} />
          </Tooltip>
        );
        return (
          <div onMouseLeave={() => setTooltipActive(false)}>
            <CopyCode onClick={copyToClipboard} />
          </div>
        );
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("rerender-state-only-in-handlers — external location invalidation", () => {
  it("stays silent when state reconciles a rendered location snapshot after pushState", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function LocationFilter() {
        const [refreshCounter, setRefreshCounter] = useState(0);
        const isSelected = new URLSearchParams(window.location.search).has("selected");
        const toggle = () => {
          const next = new URLSearchParams(window.location.search);
          if (next.has("selected")) next.delete("selected");
          else next.set("selected", "yes");
          window.history.pushState({}, "", \`?\${next}\`);
          setRefreshCounter((previous) => previous + 1);
        };
        return <button aria-pressed={isSelected} onClick={toggle}>Toggle</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on the authentic updater and render-helper shape", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function EditorialHealthPanel() {
        const [searchParams, setSearchParams] = useState(
          () => new URLSearchParams(window.location.search),
        );
        const filterSet = (parameter) => new Set(
          (new URLSearchParams(window.location.search).get(parameter) || "").split(","),
        );
        const toggleFilter = (parameter, token) => {
          setSearchParams((previous) => {
            const next = new URLSearchParams(previous);
            if (next.has(parameter)) next.delete(parameter);
            else next.set(parameter, token);
            window.history.pushState({}, "", \`?\${next}\`);
            return next;
          });
        };
        const renderRow = (token) => {
          const isActive = filterSet("filter").has(token);
          return <button aria-pressed={isActive} onClick={() => toggleFilter("filter", token)}>{token}</button>;
        };
        return <div>{["open", "closed"].map(renderRow)}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a popstate listener reconciles a rendered location snapshot", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function LocationStatus() {
        const [revision, setRevision] = useState(0);
        useEffect(() => {
          const onPopState = () => setRevision((previous) => previous + 1);
          window.addEventListener("popstate", onPopState);
          return () => window.removeEventListener("popstate", onPopState);
        }, []);
        return <output>{window.location.pathname}</output>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when wrapped listener literals leave a location listener mounted", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function WrappedCapturePopStateListener() {
        const [revision, setRevision] = useState(0);
        useEffect(() => {
          const onPopState = () => setRevision((previous) => previous + 1);
          window.addEventListener(
            "popstate" as const,
            onPopState,
            ({ capture: true as const } satisfies AddEventListenerOptions),
          );
          window.removeEventListener(
            "popstate" as const,
            onPopState,
            ({ capture: false as const } satisfies EventListenerOptions),
          );
        }, []);
        return <output>{location.pathname}</output>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a wrapped location listener removed before mount exit", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function RemovedWrappedPopStateListener() {
        const [revision, setRevision] = useState(0);
        useEffect(() => {
          const onPopState = () => setRevision((previous) => previous + 1);
          window.addEventListener(
            "popstate" as const,
            onPopState,
            ({ capture: true as const } satisfies AddEventListenerOptions),
          );
          window.removeEventListener(
            "popstate" as const,
            onPopState,
            ({ capture: true as const } satisfies EventListenerOptions),
          );
        }, []);
        return <output>{location.pathname}</output>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("revision");
  });

  it.each([
    {
      name: "removal capture",
      registrationOptions: "{ capture: true }",
      removalOptions: "{ capture: shouldCapture }",
    },
    {
      name: "registration capture",
      registrationOptions: "{ capture: shouldCapture }",
      removalOptions: "{ capture: true }",
    },
  ])("stays silent when the $name is indeterminate", ({ registrationOptions, removalOptions }) => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function IndeterminateCapturePopStateListener({ shouldCapture }) {
        const [revision, setRevision] = useState(0);
        useEffect(() => {
          const onPopState = () => setRevision((previous) => previous + 1);
          window.addEventListener("popstate", onPopState, ${registrationOptions});
          window.removeEventListener("popstate", onPopState, ${removalOptions});
        }, [shouldCapture]);
        return <output>{location.pathname}</output>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    {
      name: "global aliases and transparent TypeScript wrappers",
      source: `import { useState } from "react";
        function AliasedLocation() {
          const [revision, setRevision] = useState(0);
          const browser = window;
          const currentLocation = browser.location as Location;
          const currentPath = currentLocation!.pathname;
          const navigationHistory = globalThis.history;
          const navigate = () => {
            navigationHistory["replaceState"]({}, "", "/next");
            setRevision((previous) => previous + 1);
          };
          return <button onClick={navigate}>{currentPath}</button>;
        }`,
    },
    {
      name: "a render-invoked useCallback location reader",
      source: `import { useCallback, useState } from "react";
        function MemoizedLocationReader() {
          const [revision, setRevision] = useState(0);
          const readPath = useCallback(() => window.location.pathname, []);
          const navigate = () => {
            history.pushState({}, "", "/next");
            setRevision((previous) => previous + 1);
          };
          return <button onClick={navigate}>{readPath()}</button>;
        }`,
    },
    {
      name: "an inline hashchange listener",
      source: `function HashStatus() {
        const [revision, setRevision] = useState(0);
        useEffect(() => {
          window.addEventListener("hashchange", () => setRevision((previous) => previous + 1));
        }, []);
        return <output>{location.hash}</output>;
      }`,
    },
    {
      name: "an unqualified global popstate listener",
      source: `function GlobalPopState() {
        const [revision, setRevision] = useState(0);
        useEffect(() => {
          const update = () => setRevision((previous) => previous + 1);
          addEventListener("popstate", update);
          return () => removeEventListener("popstate", update);
        }, []);
        return <output>{globalThis.location.pathname}</output>;
      }`,
    },
    {
      name: "a multi-hop synchronous navigation helper",
      source: `function HelperNavigation() {
        const [revision, setRevision] = useState(0);
        const commitNavigation = () => history.pushState({}, "", "/next");
        const navigate = () => commitNavigation();
        const handleClick = () => {
          navigate();
          setRevision((previous) => previous + 1);
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "a cyclic helper reaches a synchronous mutation through its cyclic callee after an earlier traversal",
      source: `function CyclicHelperNavigation() {
        const [primingRevision, setPrimingRevision] = useState(0);
        const [revision, setRevision] = useState(0);
        const mutateLocation = (shouldReenter) => {
          if (shouldReenter) callCycle(false);
          history.pushState({}, "", "/next");
        };
        const callCycle = (shouldReenter) => mutateLocation(shouldReenter);
        const primeAnalysis = () => {
          setPrimingRevision((previous) => {
            mutateLocation(true);
            return previous + 1;
          });
        };
        const handleClick = () => {
          callCycle(false);
          setRevision((previous) => previous + 1);
        };
        return <><button onClick={primeAnalysis}>Prime</button><button onClick={handleClick}>{location.pathname}</button></>;
      }`,
    },
  ])("stays silent for $name", ({ source }) => {
    const result = runRule(rerenderStateOnlyInHandlers, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags unrelated write-only state beside a location invalidator", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function LocationToolbar() {
        const [revision, setRevision] = useState(0);
        const [logged, setLogged] = useState(false);
        const activePath = window.location.pathname;
        const navigate = () => {
          window.history.pushState({}, "", "/next");
          setRevision((previous) => previous + 1);
        };
        return <div><button onClick={navigate}>{activePath}</button><button onClick={() => setLogged(true)}>Log</button></div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("logged");
  });

  it.each([
    {
      name: "the location read is confined to the event handler",
      source: `function HandlerOnlyLocationRead() {
        const [logged, setLogged] = useState(false);
        const handleClick = () => {
          window.history.pushState({}, "", window.location.pathname);
          setLogged(true);
        };
        return <button onClick={handleClick}>Log</button>;
      }`,
    },
    {
      name: "the location objects are shadowed userland values",
      source: `function ShadowedLocation({ window }) {
        const [logged, setLogged] = useState(false);
        const currentPath = window.location.pathname;
        const handleClick = () => {
          window.history.pushState({}, "", "/next");
          setLogged(true);
        };
        return <button onClick={handleClick}>{currentPath}</button>;
      }`,
    },
    {
      name: "the setter is unrelated to the rendered location snapshot",
      source: `function UnrelatedSetter() {
        const [logged, setLogged] = useState(false);
        return <button onClick={() => setLogged(true)}>{window.location.pathname}</button>;
      }`,
    },
    {
      name: "the history mutation is deferred until after the setter-triggered render",
      source: `function DeferredNavigation() {
        const [logged, setLogged] = useState(false);
        const handleClick = () => {
          setTimeout(() => window.history.pushState({}, "", "/next"), 0);
          setLogged(true);
        };
        return <button onClick={handleClick}>{window.location.pathname}</button>;
      }`,
    },
    {
      name: "a non-window event target owns the popstate listener",
      source: `function UserlandPopState() {
        const [logged, setLogged] = useState(false);
        useEffect(() => {
          document.addEventListener("popstate", () => setLogged(true));
        }, []);
        return <output>{window.location.pathname}</output>;
      }`,
    },
    {
      name: "a shadowed setter performs the location mutation",
      source: `function ShadowedSetter() {
        const [logged, setLogged] = useState(false);
        const navigate = (setLogged) => {
          history.pushState({}, "", "/next");
          setLogged(true);
        };
        return <button onClick={() => navigate(console.log)}>{window.location.pathname}</button>;
      }`,
    },
    {
      name: "an async navigation helper mutates location after suspension",
      source: `function AsyncNavigation() {
        const [logged, setLogged] = useState(false);
        const navigate = async () => {
          await Promise.resolve();
          history.pushState({}, "", "/next");
        };
        const handleClick = () => {
          void navigate();
          setLogged(true);
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "a synchronous helper only schedules a deferred location mutation",
      source: `function DeferredNavigationHelper() {
        const [logged, setLogged] = useState(false);
        const navigate = () => setTimeout(() => history.pushState({}, "", "/next"), 0);
        const handleClick = () => {
          navigate();
          setLogged(true);
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "a cyclic helper only reaches a deferred location mutation",
      source: `function CyclicDeferredNavigation() {
        const [logged, setLogged] = useState(false);
        const scheduleLocation = (shouldReenter) => {
          if (shouldReenter) callCycle(false);
          setTimeout(() => history.pushState({}, "", "/next"), 0);
        };
        const callCycle = (shouldReenter) => scheduleLocation(shouldReenter);
        const handleClick = () => {
          callCycle(false);
          setLogged(true);
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
  ])("still flags write-only state when $name", ({ source }) => {
    const result = runRule(rerenderStateOnlyInHandlers, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("logged");
  });

  it.each([
    {
      name: "a conditional mutation can precede the setter on the same path",
      source: `function ConditionalNavigation({ shouldNavigate }) {
        const [revision, setRevision] = useState(0);
        const handleClick = () => {
          if (shouldNavigate) history.pushState({}, "", "/next");
          setRevision((previous) => previous + 1);
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "a setter helper follows a sibling mutation helper",
      source: `function SetterHelperNavigation() {
        const [revision, setRevision] = useState(0);
        const invalidate = () => setRevision((previous) => previous + 1);
        const navigate = () => history.pushState({}, "", "/next");
        const handleClick = () => {
          navigate();
          invalidate();
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "a registered listener delegates to a setter helper",
      source: `function DelegatedPopState() {
        const [revision, setRevision] = useState(0);
        const invalidate = () => setRevision((previous) => previous + 1);
        const onPopState = () => invalidate();
        useEffect(() => {
          window.addEventListener("popstate", onPopState);
          return () => window.removeEventListener("popstate", onPopState);
        }, []);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "an inline registered listener delegates to a setter helper",
      source: `function InlineDelegatedPopState() {
        const [revision, setRevision] = useState(0);
        const invalidate = () => setRevision((previous) => previous + 1);
        useEffect(() => {
          window.addEventListener("popstate", () => invalidate());
        }, []);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a synchronous iterator callback mutates location before the setter",
      source: `function IteratorNavigation() {
        const [revision, setRevision] = useState(0);
        const navigate = () => ["/next"].forEach((nextPath) => {
          history.pushState({}, "", nextPath);
        });
        const handleClick = () => {
          navigate();
          setRevision((previous) => previous + 1);
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "a wrapped synchronous iterator callback mutates location before the setter",
      source: `function WrappedIteratorNavigation() {
        const [revision, setRevision] = useState(0);
        const navigate = () => ["/next"].forEach(((nextPath) => {
          history.pushState({}, "", nextPath);
        }) satisfies ((nextPath: string) => void));
        const handleClick = () => {
          navigate();
          setRevision((previous) => previous + 1);
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "a Promise executor mutates location synchronously before the setter",
      source: `function PromiseExecutorNavigation() {
        const [revision, setRevision] = useState(0);
        const navigate = () => new Promise((resolve) => {
          history.pushState({}, "", "/next");
          resolve(undefined);
        });
        const handleClick = () => {
          void navigate();
          setRevision((previous) => previous + 1);
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "a wrapped Promise executor mutates location synchronously before the setter",
      source: `function WrappedPromiseExecutorNavigation() {
        const [revision, setRevision] = useState(0);
        const navigate = () => new Promise(((resolve) => {
          history.pushState({}, "", "/next");
          resolve(undefined);
        }) satisfies ((value: undefined) => void));
        const handleClick = () => {
          void navigate();
          setRevision((previous) => previous + 1);
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "a wrapped synchronous render callback reads the location snapshot",
      source: `function WrappedRenderReaderNavigation() {
        const [revision, setRevision] = useState(0);
        const currentPaths = [0].map(((index) => location.pathname) satisfies ((index: number) => string));
        const handleClick = () => {
          history.pushState({}, "", "/next");
          setRevision((previous) => previous + 1);
        };
        return <button onClick={handleClick}>{currentPaths.join("")}</button>;
      }`,
    },
    {
      name: "an async helper mutates location before its first suspension",
      source: `function AsyncPrefixNavigation() {
        const [revision, setRevision] = useState(0);
        const navigate = async () => {
          history.pushState({}, "", "/next");
          await Promise.resolve();
        };
        const handleClick = () => {
          void navigate();
          setRevision((previous) => previous + 1);
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "a mounted effect invokes a listener registration helper",
      source: `function RegistrationHelper() {
        const [revision, setRevision] = useState(0);
        const onPopState = () => setRevision((previous) => previous + 1);
        const register = () => window.addEventListener("popstate", onPopState);
        useEffect(() => {
          register();
          return () => window.removeEventListener("popstate", onPopState);
        }, []);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a listener removal helper is conditional",
      source: `function ConditionalRemovalHelper({ shouldRemove }) {
        const [revision, setRevision] = useState(0);
        const onPopState = () => setRevision((previous) => previous + 1);
        const unregister = () => {
          if (shouldRemove) window.removeEventListener("popstate", onPopState);
        };
        useEffect(() => {
          window.addEventListener("popstate", onPopState);
          unregister();
        }, [shouldRemove]);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a listener removal helper uses one branch of a conditional expression",
      source: `function ConditionalExpressionRemovalHelper({ shouldRemove }) {
        const [revision, setRevision] = useState(0);
        const onPopState = () => setRevision((previous) => previous + 1);
        const unregister = () => shouldRemove
          ? window.removeEventListener("popstate", onPopState)
          : undefined;
        useEffect(() => {
          window.addEventListener("popstate", onPopState);
          unregister();
        }, [shouldRemove]);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a direct listener removal uses one branch of a conditional expression",
      source: `function ConditionalExpressionDirectRemoval({ shouldRemove }) {
        const [revision, setRevision] = useState(0);
        const onPopState = () => setRevision((previous) => previous + 1);
        useEffect(() => {
          window.addEventListener("popstate", onPopState);
          shouldRemove ? window.removeEventListener("popstate", onPopState) : undefined;
        }, [shouldRemove]);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a listener removal helper is short-circuited",
      source: `function ShortCircuitRemovalHelper({ shouldRemove }) {
        const [revision, setRevision] = useState(0);
        const onPopState = () => setRevision((previous) => previous + 1);
        const unregister = () => shouldRemove &&
          window.removeEventListener("popstate", onPopState);
        useEffect(() => {
          window.addEventListener("popstate", onPopState);
          unregister();
        }, [shouldRemove]);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "an exhaustive inner conditional-expression removal is short-circuited",
      source: `function NestedShortCircuitRemoval({ shouldRemove, capture }) {
        const [revision, setRevision] = useState(0);
        const onPopState = () => setRevision((previous) => previous + 1);
        const unregister = () => shouldRemove && (capture
          ? window.removeEventListener("popstate", onPopState)
          : window.removeEventListener("popstate", onPopState));
        useEffect(() => {
          window.addEventListener("popstate", onPopState);
          unregister();
        }, [capture, shouldRemove]);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "only one nested conditional-expression path removes the listener",
      source: `function NestedConditionalExpressionRemoval({ first, second }) {
        const [revision, setRevision] = useState(0);
        const onPopState = () => setRevision((previous) => previous + 1);
        const unregister = () => first
          ? second
            ? window.removeEventListener("popstate", onPopState)
            : undefined
          : window.removeEventListener("popstate", onPopState);
        useEffect(() => {
          window.addEventListener("popstate", onPopState);
          unregister();
        }, [first, second]);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a branch removes its listener before registering it",
      source: `function RemovalBeforeBranchRegistration({ shouldRegister }) {
        const [revision, setRevision] = useState(0);
        const onPopState = () => setRevision((previous) => previous + 1);
        useEffect(() => {
          shouldRegister
            ? (window.removeEventListener("popstate", onPopState),
              window.addEventListener("popstate", onPopState))
            : undefined;
        }, [shouldRegister]);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a statically falsy and-expression skips listener removal",
      source: `function FalsyAndRemoval() {
        const [revision, setRevision] = useState(0);
        const onPopState = () => setRevision((previous) => previous + 1);
        useEffect(() => {
          ((window.addEventListener("popstate", onPopState), false) as boolean) &&
            window.removeEventListener("popstate", onPopState);
        }, []);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a statically truthy or-expression skips listener removal",
      source: `function TruthyOrRemoval() {
        const [revision, setRevision] = useState(0);
        const onPopState = () => setRevision((previous) => previous + 1);
        useEffect(() => {
          ((window.addEventListener("popstate", onPopState), true) satisfies boolean) ||
            window.removeEventListener("popstate", onPopState);
        }, []);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a statically falsy conditional selects the branch without listener removal",
      source: `function FalsyConditionalRemoval() {
        const [revision, setRevision] = useState(0);
        const onPopState = () => setRevision((previous) => previous + 1);
        useEffect(() => {
          ((window.addEventListener("popstate", onPopState), false) as boolean)
            ? window.removeEventListener("popstate", onPopState)
            : undefined;
        }, []);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a listener removal helper has an early-return path",
      source: `function EarlyReturnRemovalHelper({ shouldKeep }) {
        const [revision, setRevision] = useState(0);
        const onPopState = () => setRevision((previous) => previous + 1);
        const unregister = () => {
          if (shouldKeep) return;
          window.removeEventListener("popstate", onPopState);
        };
        useEffect(() => {
          window.addEventListener("popstate", onPopState);
          unregister();
        }, [shouldKeep]);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a nested listener removal helper remains conditional",
      source: `function NestedConditionalRemovalHelper({ shouldRemove }) {
        const [revision, setRevision] = useState(0);
        const onPopState = () => setRevision((previous) => previous + 1);
        const maybeUnregister = () => {
          if (shouldRemove) window.removeEventListener("popstate", onPopState);
        };
        const unregister = () => maybeUnregister();
        useEffect(() => {
          window.addEventListener("popstate", onPopState);
          unregister();
        }, [shouldRemove]);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a listener removal helper defers removal until after suspension",
      source: `function AsyncRemovalHelper() {
        const [revision, setRevision] = useState(0);
        const onPopState = () => setRevision((previous) => previous + 1);
        const unregister = async () => {
          await Promise.resolve();
          window.removeEventListener("popstate", onPopState);
        };
        useEffect(() => {
          window.addEventListener("popstate", onPopState);
          void unregister();
        }, []);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a direct listener removal follows suspension",
      source: `function AsyncDirectRemoval() {
        const [revision, setRevision] = useState(0);
        const onPopState = () => setRevision((previous) => previous + 1);
        const registerTemporarily = async () => {
          window.addEventListener("popstate", onPopState);
          await Promise.resolve();
          window.removeEventListener("popstate", onPopState);
        };
        useEffect(() => {
          void registerTemporarily();
        }, []);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a listener removal helper is called after suspension",
      source: `function AsyncRemovalHelperCall() {
        const [revision, setRevision] = useState(0);
        const onPopState = () => setRevision((previous) => previous + 1);
        const unregister = () => window.removeEventListener("popstate", onPopState);
        const registerTemporarily = async () => {
          window.addEventListener("popstate", onPopState);
          await Promise.resolve();
          unregister();
        };
        useEffect(() => {
          void registerTemporarily();
        }, []);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a listener removal callback may execute zero times",
      source: `function OptionalIteratorRemovalHelper({ removals }) {
        const [revision, setRevision] = useState(0);
        const onPopState = () => setRevision((previous) => previous + 1);
        const unregister = () => removals.forEach(() => {
          window.removeEventListener("popstate", onPopState);
        });
        useEffect(() => {
          window.addEventListener("popstate", onPopState);
          unregister();
        }, [removals]);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a React event batches the setter before the location mutation",
      source: `function BatchedEventNavigation() {
        const [revision, setRevision] = useState(0);
        const handleClick = () => {
          setRevision((previous) => previous + 1);
          history.pushState({}, "", "/next");
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "an inline React event batches the setter before the location mutation",
      source: `function InlineBatchedEventNavigation() {
        const [revision, setRevision] = useState(0);
        return <button onClick={() => {
          setRevision((previous) => previous + 1);
          history.pushState({}, "", "/next");
        }}>{location.pathname}</button>;
      }`,
    },
    {
      name: "a reassignment makes opposite-looking guards executable on one path",
      source: `function ReassignedGuardNavigation({ shouldNavigate: initialShouldNavigate }) {
        const [revision, setRevision] = useState(0);
        const handleClick = () => {
          let shouldNavigate = initialShouldNavigate;
          if (shouldNavigate) history.pushState({}, "", "/next");
          shouldNavigate = false;
          if (!shouldNavigate) setRevision((previous) => previous + 1);
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "a mutable member can change between opposite-looking guards",
      source: `function MutableMemberGuardNavigation({ navigationState }) {
        const [revision, setRevision] = useState(0);
        const handleClick = () => {
          if (navigationState.shouldNavigate) history.pushState({}, "", "/next");
          navigationState.shouldNavigate = false;
          if (!navigationState.shouldNavigate) setRevision((previous) => previous + 1);
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "a predicate call can change between opposite-looking guards",
      source: `function PredicateGuardNavigation({ shouldNavigate }) {
        const [revision, setRevision] = useState(0);
        const handleClick = () => {
          if (shouldNavigate()) history.pushState({}, "", "/next");
          if (!shouldNavigate()) setRevision((previous) => previous + 1);
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "nested matching stable guards can execute on one path",
      source: `function NestedMatchingGuardNavigation({ shouldNavigate }) {
        const [revision, setRevision] = useState(0);
        const handleClick = () => {
          if (shouldNavigate) {
            history.pushState({}, "", "/next");
            if (shouldNavigate) setRevision((previous) => previous + 1);
          }
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "a mismatched capture removal leaves the location listener active",
      source: `function CapturePopStateListener() {
        const [revision, setRevision] = useState(0);
        const onPopState = () => setRevision((previous) => previous + 1);
        useEffect(() => {
          window.addEventListener("popstate", onPopState, true);
          window.removeEventListener("popstate", onPopState, false);
          return () => window.removeEventListener("popstate", onPopState, true);
        }, []);
        return <output>{location.pathname}</output>;
      }`,
    },
  ])("stays silent when $name", ({ source }) => {
    const result = runRule(rerenderStateOnlyInHandlers, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    {
      name: "separate statements have opposite stable guards",
      source: `function OppositeGuardNavigation({ shouldNavigate }) {
        const [logged, setLogged] = useState(false);
        const handleClick = () => {
          if (shouldNavigate) history.pushState({}, "", "/next");
          if (!shouldNavigate) setLogged(true);
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "separate logical expressions have opposite stable guards",
      source: `function OppositeLogicalGuardNavigation({ shouldNavigate }) {
        const [logged, setLogged] = useState(false);
        const handleClick = () => {
          (shouldNavigate satisfies boolean) && history.pushState({}, "", "/next");
          !(shouldNavigate as boolean) && setLogged(true);
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "separate conditional expressions have opposite stable guards",
      source: `function OppositeConditionalGuardNavigation({ shouldNavigate }) {
        const [logged, setLogged] = useState(false);
        const handleClick = () => {
          shouldNavigate ? history.pushState({}, "", "/next") : undefined;
          !shouldNavigate ? setLogged(true) : undefined;
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "an internally contradictory nested guard is unreachable",
      source: `function ContradictoryNestedGuardNavigation({ shouldNavigate }) {
        const [logged, setLogged] = useState(false);
        const handleClick = () => {
          if (shouldNavigate) {
            history.pushState({}, "", "/next");
            if (!shouldNavigate) setLogged(true);
          }
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "opposite stable guards accumulate through multiple ancestors",
      source: `function MultipleAncestorGuardNavigation({ isReady, shouldNavigate }) {
        const [logged, setLogged] = useState(false);
        const handleClick = () => {
          if (isReady) {
            if (shouldNavigate) history.pushState({}, "", "/next");
          }
          if (isReady) {
            if (!shouldNavigate) setLogged(true);
          }
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "history mutation and setter occupy mutually exclusive branches",
      source: `function ExclusiveNavigation({ shouldNavigate }) {
        const [logged, setLogged] = useState(false);
        const handleClick = () => {
          if (shouldNavigate) history.pushState({}, "", "/next");
          else setLogged(true);
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "an early return separates the setter from the history mutation",
      source: `function EarlyReturnNavigation({ shouldNavigate }) {
        const [logged, setLogged] = useState(false);
        const handleClick = () => {
          if (!shouldNavigate) {
            setLogged(true);
            return;
          }
          history.pushState({}, "", "/next");
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "a conditional expression separates the mutation and setter",
      source: `function ConditionalExpressionNavigation({ shouldNavigate }) {
        const [logged, setLogged] = useState(false);
        const handleClick = () => shouldNavigate
          ? history.pushState({}, "", "/next")
          : setLogged(true);
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "an async handler mutates history after the setter and suspension",
      source: `function SuspendedHandlerNavigation() {
        const [logged, setLogged] = useState(false);
        const handleClick = async () => {
          setLogged(true);
          await Promise.resolve();
          history.pushState({}, "", "/next");
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "a listener registration helper is never invoked",
      source: `function UnusedRegistration() {
        const [logged, setLogged] = useState(false);
        const onPopState = () => setLogged(true);
        const register = () => window.addEventListener("popstate", onPopState);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a listener registration is statically unreachable",
      source: `function UnreachableRegistration() {
        const [logged, setLogged] = useState(false);
        const onPopState = () => setLogged(true);
        useEffect(() => {
          if (false) window.addEventListener("popstate", onPopState);
        }, []);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a listener is registered only from effect cleanup",
      source: `function CleanupRegistration() {
        const [logged, setLogged] = useState(false);
        const onPopState = () => setLogged(true);
        useEffect(() => () => {
          window.addEventListener("popstate", onPopState);
        }, []);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a userland function named useEffect receives the listener callback",
      source: `function ShadowedEffect({ useEffect }) {
        const [logged, setLogged] = useState(false);
        const onPopState = () => setLogged(true);
        useEffect(() => {
          window.addEventListener("popstate", onPopState);
        });
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "an async helper mutates history only after suspension",
      source: `function AsyncSuffixNavigation() {
        const [logged, setLogged] = useState(false);
        const navigate = async () => {
          await Promise.resolve();
          history.pushState({}, "", "/next");
        };
        const handleClick = () => {
          void navigate();
          setLogged(true);
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "a Promise continuation mutates history after the setter call",
      source: `function PromiseContinuationNavigation() {
        const [logged, setLogged] = useState(false);
        const navigate = () => Promise.resolve().then(() => {
          history.pushState({}, "", "/next");
        });
        const handleClick = () => {
          void navigate();
          setLogged(true);
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "flushSync commits the setter before the location mutation",
      source: `import { flushSync } from "react-dom";
      function FlushedNavigation() {
        const [logged, setLogged] = useState(false);
        const handleClick = () => {
          flushSync(() => setLogged(true));
          history.pushState({}, "", "/next");
        };
        return <button onClick={handleClick}>{location.pathname}</button>;
      }`,
    },
    {
      name: "a timer callback may flush the setter before the location mutation",
      source: `function TimerNavigation() {
        const [logged, setLogged] = useState(false);
        useEffect(() => {
          const timer = setTimeout(() => {
            setLogged(true);
            history.pushState({}, "", "/next");
          }, 0);
          return () => clearTimeout(timer);
        }, []);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "the mounted effect removes its listener before returning",
      source: `function RemovedPopStateListener() {
        const [logged, setLogged] = useState(false);
        const onPopState = () => setLogged(true);
        useEffect(() => {
          window.addEventListener("popstate", onPopState);
          window.removeEventListener("popstate", onPopState);
        }, []);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "the mounted effect removes a helper-registered listener before returning",
      source: `function RemovedHelperPopStateListener() {
        const [logged, setLogged] = useState(false);
        const onPopState = () => setLogged(true);
        const register = () => window.addEventListener("popstate", onPopState);
        useEffect(() => {
          register();
          window.removeEventListener("popstate", onPopState);
        }, []);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "the mounted effect invokes a listener removal helper before returning",
      source: `function RemovalHelperPopStateListener() {
        const [logged, setLogged] = useState(false);
        const onPopState = () => setLogged(true);
        const unregister = () => window.removeEventListener("popstate", onPopState);
        useEffect(() => {
          window.addEventListener("popstate", onPopState);
          unregister();
        }, []);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "every branch of a removal helper removes the listener",
      source: `function ExhaustiveRemovalHelper({ capture }) {
        const [logged, setLogged] = useState(false);
        const onPopState = () => setLogged(true);
        const unregister = () => {
          if (capture) window.removeEventListener("popstate", onPopState, true);
          else window.removeEventListener("popstate", onPopState, true);
        };
        useEffect(() => {
          window.addEventListener("popstate", onPopState, true);
          unregister();
        }, [capture]);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "both conditional-expression branches remove the listener",
      source: `function ExhaustiveConditionalExpressionRemoval({ capture }) {
        const [logged, setLogged] = useState(false);
        const onPopState = () => setLogged(true);
        const unregister = () => capture
          ? window.removeEventListener("popstate", onPopState, true)
          : window.removeEventListener("popstate", onPopState, true);
        useEffect(() => {
          window.addEventListener("popstate", onPopState, true);
          unregister();
        }, [capture]);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "both direct conditional-expression branches remove the listener",
      source: `function ExhaustiveDirectConditionalExpressionRemoval({ capture }) {
        const [logged, setLogged] = useState(false);
        const onPopState = () => setLogged(true);
        useEffect(() => {
          window.addEventListener("popstate", onPopState, true);
          capture
            ? window.removeEventListener("popstate", onPopState, true)
            : window.removeEventListener("popstate", onPopState, true);
        }, [capture]);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a branch removes its listener after registering it",
      source: `function RemovalAfterBranchRegistration({ shouldRegister }) {
        const [logged, setLogged] = useState(false);
        const onPopState = () => setLogged(true);
        useEffect(() => {
          shouldRegister
            ? (window.addEventListener("popstate", onPopState),
              window.removeEventListener("popstate", onPopState))
            : undefined;
        }, [shouldRegister]);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a statically truthy and-expression removes the listener",
      source: `function TruthyAndRemoval() {
        const [logged, setLogged] = useState(false);
        const onPopState = () => setLogged(true);
        useEffect(() => {
          ((window.addEventListener("popstate", onPopState), true) as boolean) &&
            window.removeEventListener("popstate", onPopState);
        }, []);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a statically falsy or-expression removes the listener",
      source: `function FalsyOrRemoval() {
        const [logged, setLogged] = useState(false);
        const onPopState = () => setLogged(true);
        useEffect(() => {
          ((window.addEventListener("popstate", onPopState), false) satisfies boolean) ||
            window.removeEventListener("popstate", onPopState);
        }, []);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a statically truthy conditional selects listener removal",
      source: `function TruthyConditionalRemoval() {
        const [logged, setLogged] = useState(false);
        const onPopState = () => setLogged(true);
        useEffect(() => {
          ((window.addEventListener("popstate", onPopState), true) as boolean)
            ? window.removeEventListener("popstate", onPopState)
            : undefined;
        }, []);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a short-circuit branch removes its listener after registering it",
      source: `function ShortCircuitBranchRemoval({ shouldRegister }) {
        const [logged, setLogged] = useState(false);
        const onPopState = () => setLogged(true);
        useEffect(() => {
          shouldRegister &&
            (window.addEventListener("popstate", onPopState),
            window.removeEventListener("popstate", onPopState));
        }, [shouldRegister]);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a branch invokes its removal helper after registering the listener",
      source: `function BranchRemovalHelper({ shouldRegister }) {
        const [logged, setLogged] = useState(false);
        const onPopState = () => setLogged(true);
        const unregister = () => window.removeEventListener("popstate", onPopState);
        useEffect(() => {
          shouldRegister
            ? (window.addEventListener("popstate", onPopState), unregister())
            : undefined;
        }, [shouldRegister]);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "every nested conditional-expression path removes the listener",
      source: `function ExhaustiveNestedConditionalExpressionRemoval({ first, second }) {
        const [logged, setLogged] = useState(false);
        const onPopState = () => setLogged(true);
        const unregister = () => first
          ? second
            ? window.removeEventListener("popstate", onPopState, true)
            : window.removeEventListener("popstate", onPopState, true)
          : window.removeEventListener("popstate", onPopState, true);
        useEffect(() => {
          window.addEventListener("popstate", onPopState, true);
          unregister();
        }, [first, second]);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "an unconditional removal helper is reached through another helper",
      source: `function NestedRemovalHelper() {
        const [logged, setLogged] = useState(false);
        const onPopState = () => setLogged(true);
        const removeListener = () => window.removeEventListener("popstate", onPopState);
        const unregister = () => removeListener();
        useEffect(() => {
          window.addEventListener("popstate", onPopState);
          unregister();
        }, []);
        return <output>{location.pathname}</output>;
      }`,
    },
    {
      name: "a custom component callback is not a proven batched React event",
      source: `function CustomCallbackNavigation() {
        const [logged, setLogged] = useState(false);
        const handleNavigate = () => {
          setLogged(true);
          history.pushState({}, "", "/next");
        };
        return <NavigationTrigger onNavigate={handleNavigate}>{location.pathname}</NavigationTrigger>;
      }`,
    },
  ])("still flags write-only state when $name", ({ source }) => {
    const result = runRule(rerenderStateOnlyInHandlers, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("logged");
  });

  it.each([
    {
      name: "a satisfies-wrapped named React useCallback remains an intrinsic event handler",
      source: `import { useCallback, useState } from "react";
        function SatisfiesWrappedCallbackNavigation() {
          const [revision, setRevision] = useState(0);
          const handleClick = (useCallback(() => {
            setRevision((previous) => previous + 1);
            history.pushState({}, "", "/next");
          }, []) satisfies React.MouseEventHandler<HTMLButtonElement>);
          return <button onClick={handleClick}>{location.pathname}</button>;
        }`,
    },
    {
      name: "an asserted namespace React useCallback remains an intrinsic event handler",
      source: `import * as React from "react";
        function AssertedNamespaceCallbackNavigation() {
          const [revision, setRevision] = React.useState(0);
          const handleClick = React.useCallback((() => {
            setRevision((previous) => previous + 1);
            history.pushState({}, "", "/next");
          }) as React.MouseEventHandler<HTMLButtonElement>, []) as React.MouseEventHandler<HTMLButtonElement>;
          return <button onClick={handleClick}>{location.pathname}</button>;
        }`,
    },
    {
      name: "an aliased React useCallback with transparent wrappers remains an intrinsic handler",
      source: `import { useCallback as useStableCallback, useState } from "react";
        function AliasedWrappedCallbackNavigation() {
          const [revision, setRevision] = useState(0);
          const handleClick = (useStableCallback((() => {
            setRevision((previous) => previous + 1);
            history.pushState({}, "", "/next");
          }) satisfies React.MouseEventHandler<HTMLButtonElement>, []) as React.MouseEventHandler<HTMLButtonElement>);
          return <button onClick={handleClick}>{location.pathname}</button>;
        }`,
    },
    {
      name: "a directly typed function remains an intrinsic event handler",
      source: `import { useState } from "react";
        function DirectTypedCallbackNavigation() {
          const [revision, setRevision] = useState(0);
          const handleClick = (() => {
            setRevision((previous) => previous + 1);
            history.pushState({}, "", "/next");
          }) satisfies React.MouseEventHandler<HTMLButtonElement>;
          return <button onClick={handleClick}>{location.pathname}</button>;
        }`,
    },
  ])("stays silent when $name", ({ source }) => {
    const result = runRule(rerenderStateOnlyInHandlers, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    {
      name: "a typed userland useCallback lookalike may defer the callback",
      source: `import { useState } from "react";
        function UserlandTypedCallbackNavigation() {
          const [logged, setLogged] = useState(false);
          const useCallback = (callback) => () => queueMicrotask(callback);
          const handleClick = (useCallback(() => {
            setLogged(true);
            history.pushState({}, "", "/next");
          }) satisfies React.MouseEventHandler<HTMLButtonElement>);
          return <button onClick={handleClick}>{location.pathname}</button>;
        }`,
    },
    {
      name: "an arbitrary userland wrapper may defer the callback",
      source: `import { useState } from "react";
        function UserlandWrappedCallbackNavigation() {
          const [logged, setLogged] = useState(false);
          const defer = (callback) => () => queueMicrotask(callback);
          const handleClick = defer(() => {
            setLogged(true);
            history.pushState({}, "", "/next");
          });
          return <button onClick={handleClick}>{location.pathname}</button>;
        }`,
    },
    {
      name: "a typed React useCallback is also passed to a custom component",
      source: `import { useCallback, useState } from "react";
        function SharedTypedCallbackNavigation() {
          const [logged, setLogged] = useState(false);
          const handleClick = (useCallback(() => {
            setLogged(true);
            history.pushState({}, "", "/next");
          }, []) satisfies React.MouseEventHandler<HTMLButtonElement>);
          return <><button onClick={handleClick}>{location.pathname}</button><Trigger onRun={handleClick} /></>;
        }`,
    },
    {
      name: "an async typed React useCallback suspends before mutating location",
      source: `import { useCallback, useState } from "react";
        function AsyncTypedCallbackNavigation() {
          const [logged, setLogged] = useState(false);
          const handleClick = (useCallback(async () => {
            setLogged(true);
            await Promise.resolve();
            history.pushState({}, "", "/next");
          }, []) satisfies React.MouseEventHandler<HTMLButtonElement>);
          return <button onClick={handleClick}>{location.pathname}</button>;
        }`,
    },
  ])("still flags write-only state when $name", ({ source }) => {
    const result = runRule(rerenderStateOnlyInHandlers, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("logged");
  });

  it.each([
    ["a statically truthy and-expression", "(true satisfies boolean) && removeListener()"],
    ["a statically falsy or-expression", "(false as boolean) || removeListener()"],
    ["a truthy final sequence value", "(undefined, true) && removeListener()"],
    ["a statically selected consequent", "true ? removeListener() : undefined"],
    ["a statically selected alternate", "false ? undefined : removeListener()"],
    ["nested statically selected logical branches", "true && (false || removeListener())"],
  ])(
    "still flags write-only state when a separate registration is followed by %s",
    (_, removal) => {
      const result = runRule(
        rerenderStateOnlyInHandlers,
        `function StaticSelectedRemoval() {
        const [logged, setLogged] = useState(false);
        const onPopState = () => setLogged(true);
        const removeListener = () => window.removeEventListener("popstate", onPopState);
        useEffect(() => {
          window.addEventListener("popstate", onPopState);
          ${removal};
        }, []);
        return <output>{location.pathname}</output>;
      }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("logged");
    },
  );

  it.each([
    ["an unknown and-expression", "shouldRemove && removeListener()"],
    ["an unknown conditional", "shouldRemove ? removeListener() : undefined"],
    ["a statically unselected and-expression", "false && removeListener()"],
    ["a statically unselected or-expression", "true || removeListener()"],
    ["a statically unselected consequent", "false ? removeListener() : undefined"],
  ])("stays silent when a separate registration is followed by %s", (_, removal) => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function OptionalSeparateRemoval({ shouldRemove }) {
        const [revision, setRevision] = useState(0);
        const onPopState = () => setRevision((previous) => previous + 1);
        const removeListener = () => window.removeEventListener("popstate", onPopState);
        useEffect(() => {
          window.addEventListener("popstate", onPopState);
          ${removal};
        }, [shouldRemove]);
        return <output>{location.pathname}</output>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    {
      name: "a named React useCallback popstate listener remains mounted",
      source: `import { useCallback, useEffect, useState } from "react";
        function NamedCallbackPopStateListener() {
          const [revision, setRevision] = useState(0);
          const onPopState = useCallback(
            () => setRevision((previous) => previous + 1),
            [],
          );
          useEffect(() => {
            window.addEventListener("popstate", onPopState);
            return () => window.removeEventListener("popstate", onPopState);
          }, [onPopState]);
          return <output>{location.pathname}</output>;
        }`,
    },
    {
      name: "a namespace React useCallback hashchange listener remains mounted",
      source: `import * as React from "react";
        function NamespaceCallbackHashChangeListener() {
          const [revision, setRevision] = React.useState(0);
          const onHashChange = React.useCallback(
            () => setRevision((previous) => previous + 1),
            [],
          );
          React.useEffect(() => {
            window.addEventListener("hashchange", onHashChange);
            return () => window.removeEventListener("hashchange", onHashChange);
          }, [onHashChange]);
          return <output>{location.hash}</output>;
        }`,
    },
    {
      name: "an aliased React useCallback helper synchronously mutates history",
      source: `import { useCallback as useStableCallback, useState } from "react";
        function AliasedCallbackNavigation() {
          const [revision, setRevision] = useState(0);
          const navigate = (useStableCallback(
            (() => history.replaceState({}, "", "/next")) satisfies (() => void),
            [],
          ) as (() => void));
          return (
            <button onClick={() => {
              navigate();
              setRevision((previous) => previous + 1);
            }}>{location.pathname}</button>
          );
        }`,
    },
    {
      name: "a React useCallback listener wraps a named local function",
      source: `import { useCallback, useEffect, useState } from "react";
        function NamedInnerCallbackListener() {
          const [revision, setRevision] = useState(0);
          const updateRevision = () => setRevision((previous) => previous + 1);
          const onPopState = useCallback(updateRevision, []);
          useEffect(() => {
            window.addEventListener("popstate", onPopState);
            return () => window.removeEventListener("popstate", onPopState);
          }, [onPopState]);
          return <output>{location.pathname}</output>;
        }`,
    },
    {
      name: "a React useCallback helper wraps a readonly alias of a local function",
      source: `import * as React from "react";
        function AliasedInnerCallbackNavigation() {
          const [revision, setRevision] = React.useState(0);
          const replacePath = () => history.replaceState({}, "", "/next");
          const replacePathAlias = replacePath;
          const navigate = React.useCallback(replacePathAlias, []);
          return (
            <button onClick={() => {
              navigate();
              setRevision((previous) => previous + 1);
            }}>{location.pathname}</button>
          );
        }`,
    },
  ])("stays silent when $name", ({ source }) => {
    const result = runRule(rerenderStateOnlyInHandlers, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    {
      name: "a userland useCallback lookalike does not preserve its listener callback",
      source: `import { useEffect, useState } from "react";
        function UserlandCallbackListener() {
          const [logged, setLogged] = useState(false);
          const useCallback = () => () => undefined;
          const onPopState = useCallback(() => setLogged(true), []);
          useEffect(() => {
            window.addEventListener("popstate", onPopState);
            return () => window.removeEventListener("popstate", onPopState);
          }, [onPopState]);
          return <output>{location.pathname}</output>;
        }`,
    },
    {
      name: "a shadowed useCallback parameter does not preserve its listener callback",
      source: `import { useCallback, useEffect, useState } from "react";
        function ShadowedCallbackListener({ useCallback }) {
          const [logged, setLogged] = useState(false);
          const onPopState = useCallback(() => setLogged(true), []);
          useEffect(() => {
            window.addEventListener("popstate", onPopState);
            return () => window.removeEventListener("popstate", onPopState);
          }, [onPopState]);
          return <output>{location.pathname}</output>;
        }`,
    },
    {
      name: "a userland React namespace lookalike does not preserve its listener callback",
      source: `import { useEffect, useState } from "react";
        const React = { useCallback: () => () => undefined };
        function UserlandNamespaceCallbackListener() {
          const [logged, setLogged] = useState(false);
          const onPopState = React.useCallback(() => setLogged(true), []);
          useEffect(() => {
            window.addEventListener("popstate", onPopState);
            return () => window.removeEventListener("popstate", onPopState);
          }, [onPopState]);
          return <output>{location.pathname}</output>;
        }`,
    },
    {
      name: "a reassigned React useCallback listener binding loses exact identity",
      source: `import { useCallback, useEffect, useState } from "react";
        function ReassignedCallbackListener() {
          const [logged, setLogged] = useState(false);
          let onPopState = useCallback(() => setLogged(true), []);
          onPopState = () => undefined;
          useEffect(() => {
            window.addEventListener("popstate", onPopState);
            return () => window.removeEventListener("popstate", onPopState);
          }, [onPopState]);
          return <output>{location.pathname}</output>;
        }`,
    },
    {
      name: "a React useCallback wrapper receives a mutable local function",
      source: `import { useCallback, useEffect, useState } from "react";
        function MutableInnerCallbackListener({ disableUpdates }) {
          const [logged, setLogged] = useState(false);
          let update = () => setLogged(true);
          if (disableUpdates) update = () => undefined;
          const onPopState = useCallback(update, []);
          useEffect(() => {
            window.addEventListener("popstate", onPopState);
            return () => window.removeEventListener("popstate", onPopState);
          }, [onPopState]);
          return <output>{location.pathname}</output>;
        }`,
    },
    {
      name: "an async React useCallback helper mutates history after suspension",
      source: `import { useCallback, useState } from "react";
        function AsyncCallbackNavigation() {
          const [logged, setLogged] = useState(false);
          const navigate = useCallback(async () => {
            await Promise.resolve();
            history.pushState({}, "", "/next");
          }, []);
          return (
            <button onClick={() => {
              void navigate();
              setLogged(true);
            }}>{location.pathname}</button>
          );
        }`,
    },
    {
      name: "a React useCallback helper defers history mutation to a timer",
      source: `import { useCallback, useState } from "react";
        function DeferredCallbackNavigation() {
          const [logged, setLogged] = useState(false);
          const navigate = useCallback(
            () => setTimeout(() => history.pushState({}, "", "/next"), 0),
            [],
          );
          return (
            <button onClick={() => {
              navigate();
              setLogged(true);
            }}>{location.pathname}</button>
          );
        }`,
    },
    {
      name: "an escaped React useCallback helper runs after the event batch",
      source: `import { useCallback, useState } from "react";
        function EscapedCallbackNavigation() {
          const [logged, setLogged] = useState(false);
          const navigate = useCallback(
            () => history.pushState({}, "", "/next"),
            [],
          );
          return (
            <button onClick={() => {
              queueMicrotask(navigate);
              setLogged(true);
            }}>{location.pathname}</button>
          );
        }`,
    },
  ])("still flags write-only state when $name", ({ source }) => {
    const result = runRule(rerenderStateOnlyInHandlers, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("logged");
  });

  it.each([
    {
      name: "a satisfies-wrapped direct function reads location during render",
      source: `import { useState } from "react";
        function WrappedDirectLocationReader() {
          const [revision, setRevision] = useState(0);
          const readPath = ((() => window.location.pathname) satisfies (() => string));
          const navigate = () => {
            history.pushState({}, "", "/next");
            setRevision((previous) => previous + 1);
          };
          return <button onClick={navigate}>{readPath()}</button>;
        }`,
    },
    {
      name: "a named React useCallback has wrapped initializer and callback",
      source: `import { useCallback, useState } from "react";
        function WrappedNamedCallbackLocationReader() {
          const [revision, setRevision] = useState(0);
          const readPath = (useCallback(
            (() => window.location.pathname) satisfies (() => string),
            [],
          ) as (() => string));
          const navigate = () => {
            history.pushState({}, "", "/next");
            setRevision((previous) => previous + 1);
          };
          return <button onClick={navigate}>{readPath()}</button>;
        }`,
    },
    {
      name: "a namespace React useCallback has wrapped initializer and callback",
      source: `import * as React from "react";
        function WrappedNamespaceCallbackLocationReader() {
          const [revision, setRevision] = React.useState(0);
          const readPath = (React.useCallback(
            (() => window.location.pathname) as (() => string),
            [],
          ) satisfies (() => string));
          const navigate = () => {
            history.pushState({}, "", "/next");
            setRevision((previous) => previous + 1);
          };
          return <button onClick={navigate}>{readPath()}</button>;
        }`,
    },
    {
      name: "a renamed React useCallback wraps a readonly local callback",
      source: `import { useCallback as useStableCallback, useState } from "react";
        function WrappedAliasedCallbackLocationReader() {
          const [revision, setRevision] = useState(0);
          const readLocation = () => window.location.pathname;
          const readPath = (useStableCallback(
            readLocation as (() => string),
            [],
          ) satisfies (() => string));
          const navigate = () => {
            history.pushState({}, "", "/next");
            setRevision((previous) => previous + 1);
          };
          return <button onClick={navigate}>{readPath()}</button>;
        }`,
    },
    {
      name: "a readonly alias preserves an exact location snapshot value",
      source: `import { useState } from "react";
        function ReadonlyAliasedLocationSnapshot() {
          const [revision, setRevision] = useState(0);
          const snapshot = window.location.pathname;
          const snapshotAlias = snapshot;
          const path = snapshotAlias;
          const navigate = () => {
            history.pushState({}, "", "/next");
            setRevision((previous) => previous + 1);
          };
          return <button onClick={navigate}>{path}</button>;
        }`,
    },
    {
      name: "an unreassigned mutable binding preserves its location snapshot value",
      source: `import { useState } from "react";
        function UnreassignedLocationSnapshot() {
          const [revision, setRevision] = useState(0);
          let path = window.location.pathname;
          const navigate = () => {
            history.pushState({}, "", "/next");
            setRevision((previous) => previous + 1);
          };
          return <button onClick={navigate}>{path}</button>;
        }`,
    },
    {
      name: "an unreassigned function declaration reads location during render",
      source: `import { useState } from "react";
        function FunctionDeclarationLocationReader() {
          const [revision, setRevision] = useState(0);
          function readPath() {
            return window.location.pathname;
          }
          const navigate = () => {
            history.pushState({}, "", "/next");
            setRevision((previous) => previous + 1);
          };
          return <button onClick={navigate}>{readPath()}</button>;
        }`,
    },
    {
      name: "a nested same-name write does not invalidate an outer function declaration",
      source: `import { useState } from "react";
        function ShadowedFunctionDeclarationLocationReader() {
          const [revision, setRevision] = useState(0);
          function readPath() {
            return window.location.pathname;
          }
          const readShadowedPath = () => {
            let readPath = () => "/first";
            readPath = () => "/second";
            return readPath();
          };
          void readShadowedPath;
          const navigate = () => {
            history.pushState({}, "", "/next");
            setRevision((previous) => previous + 1);
          };
          return <button onClick={navigate}>{readPath()}</button>;
        }`,
    },
  ])("stays silent when $name", ({ source }) => {
    const result = runRule(rerenderStateOnlyInHandlers, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    {
      name: "a userland useCallback lookalike wraps a location reader",
      source: `import { useState } from "react";
        function UserlandWrappedLocationReader() {
          const [revision, setRevision] = useState(0);
          const useCallback = (callback) => () => callback();
          const readPath = (useCallback(
            (() => window.location.pathname) satisfies (() => string),
            [],
          ) as (() => string));
          const navigate = () => {
            history.pushState({}, "", "/next");
            setRevision((previous) => previous + 1);
          };
          return <button onClick={navigate}>{readPath()}</button>;
        }`,
    },
    {
      name: "a shadowed React useCallback binding wraps a location reader",
      source: `import { useCallback, useState } from "react";
        function ShadowedWrappedLocationReader({ useCallback }) {
          const [revision, setRevision] = useState(0);
          const readPath = (useCallback(
            (() => window.location.pathname) satisfies (() => string),
            [],
          ) as (() => string));
          const navigate = () => {
            history.pushState({}, "", "/next");
            setRevision((previous) => previous + 1);
          };
          return <button onClick={navigate}>{readPath()}</button>;
        }`,
    },
    {
      name: "a mutable direct function loses exact location-reader identity",
      source: `import { useState } from "react";
        function MutableWrappedLocationReader({ useStaticPath }) {
          const [revision, setRevision] = useState(0);
          let readPath = (() => window.location.pathname) as (() => string);
          if (useStaticPath) readPath = () => "/static";
          const navigate = () => {
            history.pushState({}, "", "/next");
            setRevision((previous) => previous + 1);
          };
          return <button onClick={navigate}>{readPath()}</button>;
        }`,
    },
    {
      name: "a mutable callback passed to React useCallback loses exact identity",
      source: `import { useCallback, useState } from "react";
        function MutableInnerWrappedLocationReader({ useStaticPath }) {
          const [revision, setRevision] = useState(0);
          let readLocation = () => window.location.pathname;
          if (useStaticPath) readLocation = () => "/static";
          const readPath = useCallback(readLocation as (() => string), []);
          const navigate = () => {
            history.pushState({}, "", "/next");
            setRevision((previous) => previous + 1);
          };
          return <button onClick={navigate}>{readPath()}</button>;
        }`,
    },
    {
      name: "a mutable React useCallback result loses exact identity",
      source: `import { useCallback, useState } from "react";
        function MutableOuterWrappedLocationReader({ useStaticPath }) {
          const [revision, setRevision] = useState(0);
          let readPath = useCallback(() => window.location.pathname, []);
          if (useStaticPath) readPath = () => "/static";
          const navigate = () => {
            history.pushState({}, "", "/next");
            setRevision((previous) => previous + 1);
          };
          return <button onClick={navigate}>{readPath()}</button>;
        }`,
    },
    {
      name: "a wrapped location reader is only passed as an event handler",
      source: `import { useCallback, useState } from "react";
        function UnusedWrappedLocationReader() {
          const [revision, setRevision] = useState(0);
          const readPath = (useCallback(
            (() => window.location.pathname) satisfies (() => string),
            [],
          ) as (() => string));
          const navigate = () => {
            history.pushState({}, "", "/next");
            setRevision((previous) => previous + 1);
          };
          return <><button onClick={readPath}>Read</button><button onClick={navigate}>Navigate</button></>;
        }`,
    },
    {
      name: "a mutable snapshot binding is replaced before render",
      source: `import { useState } from "react";
        function ReassignedLocationSnapshot() {
          const [revision, setRevision] = useState(0);
          let path = window.location.pathname;
          path = "/fixed";
          const navigate = () => {
            history.pushState({}, "", "/next");
            setRevision((previous) => previous + 1);
          };
          return <button onClick={navigate}>{path}</button>;
        }`,
    },
    {
      name: "a mutable alias replaces a readonly location snapshot before render",
      source: `import { useState } from "react";
        function ReassignedLocationSnapshotAlias() {
          const [revision, setRevision] = useState(0);
          const snapshot = window.location.pathname;
          let path = snapshot;
          path = "/fixed";
          const navigate = () => {
            history.pushState({}, "", "/next");
            setRevision((previous) => previous + 1);
          };
          return <button onClick={navigate}>{path}</button>;
        }`,
    },
    {
      name: "a reassigned function declaration loses exact location-reader identity",
      source: `import { useState } from "react";
        function ReassignedFunctionDeclarationLocationReader() {
          const [revision, setRevision] = useState(0);
          function readPath() {
            return window.location.pathname;
          }
          readPath = () => "/fixed";
          const navigate = () => {
            history.pushState({}, "", "/next");
            setRevision((previous) => previous + 1);
          };
          return <button onClick={navigate}>{readPath()}</button>;
        }`,
    },
  ])("still flags write-only state when $name", ({ source }) => {
    const result = runRule(rerenderStateOnlyInHandlers, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("revision");
  });

  it.each([
    {
      name: "a readonly setter alias follows the location mutation",
      source: `import { useState } from "react";
        function ReadonlySetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const bump = setRevision;
          const navigate = () => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          };
          const reset = () => setRevision(0);
          return <><button onClick={navigate}>Go</button><button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a multi-hop readonly setter alias follows the location mutation",
      source: `import { useState } from "react";
        function MultiHopReadonlySetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const bump = setRevision;
          const trigger = bump;
          const invalidate = trigger;
          const navigate = () => {
            history.pushState({}, "", "/next");
            invalidate((previous) => previous + 1);
          };
          const reset = () => setRevision(0);
          return <><button onClick={navigate}>Go</button><button onClick={reset}>Reset</button><output>{window.location.pathname}</output></>;
        }`,
    },
    {
      name: "a type-wrapped setter alias is called from a wrapped React callback",
      source: `import { useCallback as useStableCallback, useState } from "react";
        function WrappedReadonlySetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const bump = ((setRevision as typeof setRevision) satisfies typeof setRevision);
          const navigate = (useStableCallback(
            (() => {
              history.pushState({}, "", "/next");
              (bump satisfies typeof bump)((previous) => previous + 1);
            }) satisfies (() => void),
            [bump],
          ) as (() => void));
          const reset = () => setRevision(0);
          return <><button onClick={navigate}>Go</button><button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a readonly setter alias is called through a wrapped local callback",
      source: `import { useCallback, useState } from "react";
        function WrappedLocalCallbackSetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const bump = setRevision;
          const mutateAndInvalidate = () => {
            history.replaceState({}, "", "/next");
            bump((previous) => previous + 1);
          };
          const navigate = useCallback(mutateAndInvalidate as (() => void), []);
          const reset = () => setRevision(0);
          return <><button onClick={navigate}>Go</button><button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a deferred handler closes over a setter declared after the handler body",
      source: `import { useState } from "react";
        function DeferredDirectSetterLocationInvalidator() {
          const navigate = () => {
            history.pushState({}, "", "/next");
            setRevision((previous) => previous + 1);
          };
          const [revision, setRevision] = useState(0);
          const reset = () => setRevision(0);
          return <><button onClick={navigate}>Go</button><button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a deferred handler closes over a readonly alias declared before its JSX escape",
      source: `import { useState } from "react";
        function DeferredReadonlySetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const navigate = () => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          };
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <><button onClick={navigate}>Go</button><button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a deferred named helper is invoked after its readonly alias initializes",
      source: `import { useState } from "react";
        function DeferredHelperReadonlySetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const mutateAndInvalidate = () => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          };
          const bump = setRevision;
          const navigate = () => mutateAndInvalidate();
          const reset = () => setRevision(0);
          return <><button onClick={navigate}>Go</button><button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a synchronous named helper is invoked after its readonly alias initializes",
      source: `import { useState } from "react";
        function SynchronousHelperReadonlySetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const mutateAndInvalidate = () => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          };
          const bump = setRevision;
          mutateAndInvalidate();
          const reset = () => setRevision(0);
          return <button onClick={reset}>{location.pathname}</button>;
        }`,
    },
    {
      name: "an unknown callback receives a helper after its readonly alias initializes",
      source: `import { useState } from "react";
        function UnknownCallbackAfterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const mutateAndInvalidate = () => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          };
          const bump = setRevision;
          runNow(mutateAndInvalidate);
          const reset = () => setRevision(0);
          return <button onClick={reset}>{location.pathname}</button>;
        }`,
    },
    {
      name: "an exact synchronous callback runs after its readonly alias initializes",
      source: `import { useState } from "react";
        function SynchronousCallbackAfterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const bump = setRevision;
          (() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          })();
          const reset = () => setRevision(0);
          return <button onClick={reset}>{location.pathname}</button>;
        }`,
    },
    {
      name: "an inline intrinsic handler is stored before its alias and returned after initialization",
      source: `import { useState } from "react";
        function StoredInlineHandlerLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const element = <button onClick={() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          }}>Go</button>;
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <>{element}<button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "an intrinsic handler is stored in an array returned after alias initialization",
      source: `import { useState } from "react";
        function ArrayStoredInlineHandlerLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const elements = [<button onClick={() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          }}>Go</button>];
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <><button onClick={reset}>Reset</button>{elements}<output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "an intrinsic handler is stored in a static object returned after alias initialization",
      source: `import { useState } from "react";
        function ObjectStoredInlineHandlerLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const views = { main: <button onClick={() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          }}>Go</button> };
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <><button onClick={reset}>Reset</button>{views.main}<output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "an intrinsic handler is stored through a conditional returned after alias initialization",
      source: `import { useState } from "react";
        function ConditionalStoredInlineHandlerLocationInvalidator({ enabled }) {
          const [revision, setRevision] = useState(0);
          const element = enabled ? <button onClick={() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          }}>Go</button> : null;
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <><button onClick={reset}>Reset</button>{element}<output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "an intrinsic handler is stored through a logical expression returned after alias initialization",
      source: `import { useState } from "react";
        function LogicalStoredInlineHandlerLocationInvalidator({ enabled }) {
          const [revision, setRevision] = useState(0);
          const element = enabled && <button onClick={() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          }}>Go</button>;
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <><button onClick={reset}>Reset</button>{element}<output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "an effect callback runs after its readonly setter alias initializes during render",
      source: `import { useEffect, useState } from "react";
        function EffectReadonlySetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          useEffect(() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          }, []);
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <button onClick={reset}>{location.pathname}</button>;
        }`,
    },
    {
      name: "an effect cannot commit from a throwing render before its readonly setter alias initializes",
      source: `import { useEffect, useState } from "react";
        function ThrowingRenderEffectSetterAliasLocationInvalidator({ shouldThrow }) {
          const [revision, setRevision] = useState(0);
          useEffect(() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          }, []);
          if (shouldThrow) throw new Error("render failed");
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <button onClick={reset}>{location.pathname}</button>;
        }`,
    },
    {
      name: "a layout effect callback runs after its readonly setter alias initializes during render",
      source: `import { useLayoutEffect, useState } from "react";
        function LayoutEffectReadonlySetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          useLayoutEffect(() => {
            history.replaceState({}, "", "/next");
            bump((previous) => previous + 1);
          }, []);
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <button onClick={reset}>{location.pathname}</button>;
        }`,
    },
    {
      name: "a mounted location listener runs after its readonly setter alias initializes during render",
      source: `import { useEffect, useState } from "react";
        function ListenerReadonlySetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          useEffect(() => {
            const onPopState = () => bump((previous) => previous + 1);
            window.addEventListener("popstate", onPopState);
            return () => window.removeEventListener("popstate", onPopState);
          }, []);
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <button onClick={reset}>{location.pathname}</button>;
        }`,
    },
    {
      name: "a readonly handler alias escapes after its readonly setter alias initializes",
      source: `import { useState } from "react";
        function ReadonlyHandlerAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const navigate = () => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          };
          const handler = navigate;
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <><button onClick={handler}>Go</button><button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "an exact useCallback result escapes after its readonly setter alias initializes",
      source: `import { useCallback, useState } from "react";
        function ReadonlyUseCallbackAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const navigate = () => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          };
          const handler = useCallback(navigate, []);
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <><button onClick={handler}>Go</button><button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a wrapped multi-hop handler alias escapes after its readonly setter alias initializes",
      source: `import { useCallback, useState } from "react";
        function MultiHopHandlerAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const navigate = () => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          };
          const firstHandler = navigate;
          const secondHandler = (firstHandler satisfies typeof firstHandler);
          const handler = useCallback(secondHandler, []);
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <><button onClick={handler}>Go</button><button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a readonly JSX value alias escapes after its readonly setter alias initializes",
      source: `import { useState } from "react";
        function ReadonlyJsxValueAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const element = <button onClick={() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          }}>Go</button>;
          const view = element;
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <>{view}<button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a wrapped multi-hop JSX value alias escapes after its readonly setter alias initializes",
      source: `import { useState } from "react";
        function MultiHopJsxValueAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const element = <button onClick={() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          }}>Go</button>;
          const firstView = element;
          const view = (firstView satisfies typeof firstView);
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <>{view}<button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a nested intrinsic handler in a stored JSX wrapper escapes after its readonly setter alias initializes",
      source: `import { useState } from "react";
        function NestedStoredJsxWrapperLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const view = <section><><button onClick={() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          }}>Go</button></></section>;
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <>{view}<button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a non-escaping void read precedes a readonly setter alias and later JSX escape",
      source: `import { useState } from "react";
        function VoidReadBeforeAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const element = <button onClick={() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          }}>Go</button>;
          void element;
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <>{element}<button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
  ])("stays silent when $name", ({ source }) => {
    const result = runRule(rerenderStateOnlyInHandlers, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    {
      name: "a mutable setter alias is reassigned before the location mutation",
      source: `import { useState } from "react";
        function ReassignedSetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          let bump = setRevision;
          bump = () => undefined;
          const navigate = () => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          };
          const reset = () => setRevision(0);
          return <><button onClick={navigate}>Go</button><button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a readonly setter alias is declared after its call",
      source: `import { useState } from "react";
        function TemporallyDeadSetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const navigate = () => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
            const bump = setRevision;
          };
          const reset = () => setRevision(0);
          return <><button onClick={navigate}>Go</button><button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a readonly setter alias initializes before the state setter",
      source: `import { useState } from "react";
        function PrematureSetterAliasInitializerLocationInvalidator() {
          const navigate = () => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          };
          const bump = setRevision;
          const [revision, setRevision] = useState(0);
          const reset = () => setRevision(0);
          return <><button onClick={navigate}>Go</button><button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a multi-hop alias reads its next alias before initialization",
      source: `import { useState } from "react";
        function ReversedMultiHopSetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const trigger = bump;
          const bump = setRevision;
          const navigate = () => {
            history.pushState({}, "", "/next");
            trigger((previous) => previous + 1);
          };
          const reset = () => setRevision(0);
          return <><button onClick={navigate}>Go</button><button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a named helper is invoked synchronously before its readonly alias initializes",
      source: `import { useState } from "react";
        function PrematureHelperSetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const mutateAndInvalidate = () => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          };
          mutateAndInvalidate();
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <button onClick={reset}>{location.pathname}</button>;
        }`,
    },
    {
      name: "an unknown callback receives a helper before its readonly alias initializes",
      source: `import { useState } from "react";
        function UnknownCallbackBeforeAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const mutateAndInvalidate = () => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          };
          runNow(mutateAndInvalidate);
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <button onClick={reset}>{location.pathname}</button>;
        }`,
    },
    {
      name: "an exact synchronous callback runs before its readonly alias initializes",
      source: `import { useState } from "react";
        function SynchronousCallbackBeforeAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          (() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          })();
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <button onClick={reset}>{location.pathname}</button>;
        }`,
    },
    {
      name: "a readonly setter alias is unreachable after the component return",
      source: `import { useState } from "react";
        function UnreachableSetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const navigate = () => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          };
          const reset = () => setRevision(0);
          return <><button onClick={navigate}>Go</button><button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
          const bump = setRevision;
        }`,
    },
    {
      name: "a deferred handler can escape through an early return before its alias initializes",
      source: `import { useState } from "react";
        function EarlyReturnSetterAliasLocationInvalidator({ shouldReturn }) {
          const [revision, setRevision] = useState(0);
          const navigate = () => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          };
          if (shouldReturn) return <button onClick={navigate}>{location.pathname}</button>;
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <button onClick={reset}>{location.pathname}</button>;
        }`,
    },
    {
      name: "an inline intrinsic handler returns before its alias initializes",
      source: `import { useState } from "react";
        function DirectInlineHandlerBeforeAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const reset = () => setRevision(0);
          return <><button onClick={() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          }}>{location.pathname}</button><button onClick={reset}>Reset</button></>;
          const bump = setRevision;
        }`,
    },
    {
      name: "a stored inline intrinsic handler escapes before its alias initializes",
      source: `import { useState } from "react";
        function EscapedInlineHandlerBeforeAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const element = <button onClick={() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          }}>Go</button>;
          registerElement(element);
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <>{element}<button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "an array-stored intrinsic handler escapes to an unknown consumer before its alias initializes",
      source: `import { useState } from "react";
        function EscapedArrayStoredInlineHandlerLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const elements = [<button onClick={() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          }}>Go</button>];
          registerElements(elements);
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <><button onClick={reset}>Reset</button>{elements}<output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "an intrinsic handler enters an opaque aggregate before its alias initializes",
      source: `import { useState } from "react";
        function OpaqueStoredInlineHandlerLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const element = prepareElement(<button onClick={() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          }}>Go</button>);
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <><button onClick={reset}>Reset</button>{element}<output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a computed object key prevents exact stored JSX provenance",
      source: `import { useState } from "react";
        function ComputedObjectStoredInlineHandlerLocationInvalidator({ viewName }) {
          const [revision, setRevision] = useState(0);
          const views = { [viewName]: <button onClick={() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          }}>Go</button> };
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <><button onClick={reset}>Reset</button>{views[viewName]}<output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a stored JSX aggregate is replaced after its setter alias initializes",
      source: `import { useState } from "react";
        function MutatedArrayStoredInlineHandlerLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const elements = [<button onClick={() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          }}>Go</button>];
          const bump = setRevision;
          elements[0] = <span>Replaced</span>;
          const reset = () => setRevision(0);
          return <><button onClick={reset}>Reset</button>{elements}<output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a stored JSX aggregate is emptied by a mutating method after its setter alias initializes",
      source: `import { useState } from "react";
        function MethodMutatedArrayStoredInlineHandlerLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const elements = [<button onClick={() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          }}>Go</button>];
          const bump = setRevision;
          elements.pop();
          const reset = () => setRevision(0);
          return <><button onClick={reset}>Reset</button>{elements}<output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a stored JSX aggregate is overwritten by Object.assign after its setter alias initializes",
      source: `import { useState } from "react";
        function AssignedObjectStoredInlineHandlerLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const views = { main: <button onClick={() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          }}>Go</button> };
          const bump = setRevision;
          Object.assign(views, { main: <span>Replaced</span> });
          const reset = () => setRevision(0);
          return <><button onClick={reset}>Reset</button>{views.main}<output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "an effect can commit from an early return before its readonly setter alias initializes",
      source: `import { useEffect, useState } from "react";
        function EffectEarlyReturnSetterAliasLocationInvalidator({ shouldReturn }) {
          const [revision, setRevision] = useState(0);
          const reset = () => setRevision(0);
          useEffect(() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          }, []);
          if (shouldReturn) return <button onClick={reset}>{location.pathname}</button>;
          const bump = setRevision;
          return <button onClick={reset}>{location.pathname}</button>;
        }`,
    },
    {
      name: "a layout effect can commit from an early return before its readonly setter alias initializes",
      source: `import { useLayoutEffect, useState } from "react";
        function LayoutEffectEarlyReturnSetterAliasLocationInvalidator({ shouldReturn }) {
          const [revision, setRevision] = useState(0);
          const reset = () => setRevision(0);
          useLayoutEffect(() => {
            history.replaceState({}, "", "/next");
            bump((previous) => previous + 1);
          }, []);
          if (shouldReturn) return <button onClick={reset}>{location.pathname}</button>;
          const bump = setRevision;
          return <button onClick={reset}>{location.pathname}</button>;
        }`,
    },
    {
      name: "a mounted listener can commit from an early return before its readonly setter alias initializes",
      source: `import { useEffect, useState } from "react";
        function ListenerEarlyReturnSetterAliasLocationInvalidator({ shouldReturn }) {
          const [revision, setRevision] = useState(0);
          const reset = () => setRevision(0);
          useEffect(() => {
            const onPopState = () => bump((previous) => previous + 1);
            window.addEventListener("popstate", onPopState);
            return () => window.removeEventListener("popstate", onPopState);
          }, []);
          if (shouldReturn) return <button onClick={reset}>{location.pathname}</button>;
          const bump = setRevision;
          return <button onClick={reset}>{location.pathname}</button>;
        }`,
    },
    {
      name: "a readonly handler alias escapes before its readonly setter alias initializes",
      source: `import { useState } from "react";
        function HandlerAliasBeforeSetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const navigate = () => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          };
          const handler = navigate;
          registerHandler(handler);
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <button onClick={reset}>{location.pathname}</button>;
        }`,
    },
    {
      name: "an exact useCallback result escapes before its readonly setter alias initializes",
      source: `import { useCallback, useState } from "react";
        function UseCallbackAliasBeforeSetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const navigate = () => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          };
          const handler = useCallback(navigate, []);
          registerHandler(handler);
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <button onClick={reset}>{location.pathname}</button>;
        }`,
    },
    {
      name: "a multi-hop handler alias escapes before its readonly setter alias initializes",
      source: `import { useCallback, useState } from "react";
        function MultiHopHandlerBeforeSetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const navigate = () => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          };
          const firstHandler = navigate;
          const handler = useCallback(firstHandler, []);
          registerHandler(handler);
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <button onClick={reset}>{location.pathname}</button>;
        }`,
    },
    {
      name: "a readonly JSX value alias escapes before its readonly setter alias initializes",
      source: `import { useState } from "react";
        function JsxValueAliasBeforeSetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const element = <button onClick={() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          }}>Go</button>;
          const view = element;
          registerElement(view);
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <button onClick={reset}>{location.pathname}</button>;
        }`,
    },
    {
      name: "a stored nested JSX wrapper escapes before its readonly setter alias initializes",
      source: `import { useState } from "react";
        function NestedStoredJsxWrapperBeforeSetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const view = <section><><button onClick={() => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          }}>Go</button></></section>;
          registerElement(view);
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <button onClick={reset}>{location.pathname}</button>;
        }`,
    },
    {
      name: "a readonly handler alias is written before it escapes",
      source: `import { useState } from "react";
        function WrittenHandlerAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const navigate = () => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          };
          const handler = navigate;
          handler = () => undefined;
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <><button onClick={handler}>Go</button><button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a readonly handler alias cycle has no exact escape provenance",
      source: `import { useState } from "react";
        function CyclicHandlerAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const navigate = handler;
          const handler = navigate;
          const bump = setRevision;
          const reset = () => setRevision(0);
          return <><button onClick={handler}>Go</button><button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a readonly setter alias has a parse-clean reassignment",
      source: `import { useState } from "react";
        function ReassignedConstSetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const bump = setRevision;
          bump = () => undefined;
          const navigate = () => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          };
          const reset = () => setRevision(0);
          return <><button onClick={navigate}>Go</button><button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a type-wrapped readonly setter alias is reassigned",
      source: `import { useState } from "react";
        function ReassignedWrappedConstSetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const bump = setRevision;
          (bump as typeof bump) = () => undefined;
          const navigate = () => {
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          };
          const reset = () => setRevision(0);
          return <><button onClick={navigate}>Go</button><button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a multi-hop alias crosses a mutable binding",
      source: `import { useState } from "react";
        function MutableMultiHopSetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          let bump = setRevision;
          const trigger = bump;
          bump = () => undefined;
          const navigate = () => {
            history.pushState({}, "", "/next");
            trigger((previous) => previous + 1);
          };
          const reset = () => setRevision(0);
          return <><button onClick={navigate}>Go</button><button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a shadowed alias is called after the location mutation",
      source: `import { useState } from "react";
        function ShadowedSetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const bump = setRevision;
          const navigate = () => {
            const bump = (updater) => updater(0);
            history.pushState({}, "", "/next");
            bump((previous) => previous + 1);
          };
          void bump;
          const reset = () => setRevision(0);
          return <><button onClick={navigate}>Go</button><button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
    {
      name: "a readonly setter alias runs in a separate event handler",
      source: `import { useState } from "react";
        function SeparateSetterAliasLocationInvalidator() {
          const [revision, setRevision] = useState(0);
          const bump = setRevision;
          const navigate = () => history.pushState({}, "", "/next");
          const increment = () => bump((previous) => previous + 1);
          const reset = () => setRevision(0);
          return <><button onClick={navigate}>Go</button><button onClick={increment}>Increment</button><button onClick={reset}>Reset</button><output>{location.pathname}</output></>;
        }`,
    },
  ])("still flags write-only state when $name", ({ source }) => {
    const result = runRule(rerenderStateOnlyInHandlers, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("revision");
  });
});
