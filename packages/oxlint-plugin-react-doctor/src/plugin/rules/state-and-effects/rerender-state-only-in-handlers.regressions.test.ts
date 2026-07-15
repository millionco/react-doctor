import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderStateOnlyInHandlers } from "./rerender-state-only-in-handlers.js";

describe("rerender-state-only-in-handlers — regressions", () => {
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
});
