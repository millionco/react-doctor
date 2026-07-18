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
