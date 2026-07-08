import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noInitializeState } from "./no-initialize-state.js";

describe("no-initialize-state — regressions", () => {
  it("stays silent when a mount effect seeds a non-deterministic id", () => {
    const result = runRule(
      noInitializeState,
      `function C() {
        const [id, setId] = useState(null);
        useEffect(() => { setId(crypto.randomUUID()); }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for Math.random / Date.now seeds", () => {
    const result = runRule(
      noInitializeState,
      `function C() {
        const [seed, setSeed] = useState(0);
        const [at, setAt] = useState(0);
        useEffect(() => { setSeed(Math.random()); setAt(Date.now()); }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a mount effect seeds a zero-arg new Date() value", () => {
    const result = runRule(
      noInitializeState,
      `function Clock() {
        const [now, setNow] = useState(null);
        useEffect(() => { setNow(new Date().toLocaleTimeString()); }, []);
        return <time>{now}</time>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the cleanup disposes the resource feeding the setter", () => {
    const result = runRule(
      noInitializeState,
      `function AudioNodeState() {
        const [gainNode, setGainNode] = useState(null);
        useEffect(() => {
          const audioContext = new AudioContext();
          setGainNode(audioContext.createGain());
          return () => {
            audioContext.close();
          };
        }, []);
        return null;
      }`,
      { filename: "audio.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a mount effect stores a socket its cleanup closes", () => {
    const result = runRule(
      noInitializeState,
      `function LiveFeed({ url }) {
        const [socket, setSocket] = useState(null);
        useEffect(() => {
          const webSocket = new WebSocket(url);
          setSocket(webSocket);
          return () => webSocket.close();
        }, []);
        return null;
      }`,
      { filename: "feed.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the setter only fires from an observer callback", () => {
    const result = runRule(
      noInitializeState,
      `function ObserverConnected() {
        const [entryCount, setEntryCount] = useState(0);
        useEffect(() => {
          const observer = new MutationObserver((mutations) => setEntryCount(mutations.length));
          observer.observe(document.body, { childList: true });
          return () => observer.disconnect();
        }, []);
        return <output>{entryCount}</output>;
      }`,
      { filename: "observer.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a hoistable literal local even when the cleanup mentions it", () => {
    const result = runRule(
      noInitializeState,
      `function C() {
        const [count, setCount] = useState(null);
        useEffect(() => {
          const initial = 42;
          setCount(initial);
          return () => console.log(initial);
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a literal init even when the effect has an unrelated cleanup", () => {
    const result = runRule(
      noInitializeState,
      `function C() {
        const [count, setCount] = useState(null);
        useEffect(() => {
          setCount(42);
          const id = setInterval(() => {}, 1000);
          return () => clearInterval(id);
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a deterministic new Date(value) init from a mount effect", () => {
    const result = runRule(
      noInitializeState,
      `function C({ createdAt }) {
        const [label, setLabel] = useState("");
        useEffect(() => { setLabel(new Date(0).toISOString()); }, []);
        return <span>{label}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a deterministic literal init from a mount effect", () => {
    const result = runRule(
      noInitializeState,
      `function C() {
        const [n, setN] = useState(0);
        useEffect(() => { setN(42); }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a storage-seeded mount init (digitalocean sea-notes Theme)", () => {
    const result = runRule(
      noInitializeState,
      `function MaterialThemeProvider({ children }) {
        const [mode, setMode] = useState('light');
        const [currentTheme, setCurrentTheme] = useState('modernize');
        useEffect(() => {
          if (typeof window !== 'undefined') {
            const storedMode = localStorage.getItem('themeMode');
            const storedTheme = localStorage.getItem('currentTheme') || 'modernize';
            if (storedMode && storedMode !== mode) setMode(storedMode);
            if (storedTheme !== currentTheme) setCurrentTheme(storedTheme);
          }
        }, []);
        return children;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a sessionStorage draft load with deterministic fallbacks (formslab)", () => {
    const result = runRule(
      noInitializeState,
      `function useCreateSurveyManager(initialData) {
        const { setActivePage } = useApplicationContext();
        const [isEditMode] = useState(Boolean(initialData));
        const [title, setTitle] = useState('My survey');
        const [isLoaded, setIsLoaded] = useState(isEditMode);
        const [questions, setQuestions] = useState([]);
        const [surveyOptions, setSurveyOptions] = useState({});
        useEffect(() => {
          setActivePage(isEditMode ? Page.EDIT_SURVEY : Page.CREATE_SURVEY);
          if (!isEditMode && typeof window !== 'undefined') {
            const draftSurvey = sessionStorage.getItem(DRAFT_SURVEY_SESSION_STORAGE);
            if (draftSurvey) {
              const { title, questions, surveyOptions } = JSON.parse(draftSurvey);
              if (title !== undefined) setTitle(title);
              if (questions !== undefined) setQuestions(questions);
              if (surveyOptions !== undefined) setSurveyOptions(surveyOptions);
            } else {
              setTitle(USER_FEEDBACK_TEMPLATE.title);
              setQuestions(USER_FEEDBACK_TEMPLATE.questions);
            }
            setIsLoaded(true);
          } else if (isEditMode) {
            setIsLoaded(true);
          }
          return () => {
            setActivePage(undefined);
          };
        }, []);
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags literal flag inits beside interval-ref bookkeeping (bradgarropy use-countdown)", () => {
    const result = runRule(
      noInitializeState,
      `function useCountdown() {
        const [isActive, setIsActive] = useState(false);
        const [isInactive, setIsInactive] = useState(true);
        const [isRunning, setIsRunning] = useState(false);
        const id = useRef(0);
        useEffect(() => {
          setIsActive(true);
          setIsInactive(false);
          setIsRunning(true);
          id.current = window.setInterval(tick, 1000);
          return () => window.clearInterval(id.current);
        }, []);
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a literal init hidden behind unrelated ref bookkeeping", () => {
    const result = runRule(
      noInitializeState,
      `function C() {
        const trackRef = useRef(false);
        const [count, setCount] = useState(0);
        useEffect(() => {
          setCount(42);
          trackRef.current = true;
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a literal init inside a bare typeof-window SSR guard", () => {
    const result = runRule(
      noInitializeState,
      `function C() {
        const [ready, setReady] = useState(false);
        useEffect(() => {
          if (typeof window !== 'undefined') setReady(true);
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a setter fed from a localStorage read via a local variable", () => {
    const result = runRule(
      noInitializeState,
      `function Theme() {
        const [theme, setTheme] = useState("light");
        useEffect(() => {
          const saved = localStorage.getItem("theme");
          setTheme(saved ?? "light");
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a stored callback whose body reads Date.now (deterministic value)", () => {
    const result = runRule(
      noInitializeState,
      `function C() {
        const [callback, setCallback] = useState(null);
        useEffect(() => {
          setCallback(() => Date.now());
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a setter argument whose member property merely shadows a global name", () => {
    const result = runRule(
      noInitializeState,
      `function C({ data }) {
        const [doc, setDoc] = useState(null);
        useEffect(() => {
          setDoc(data.document);
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when the setter argument is a ref DOM measurement", () => {
    const result = runRule(
      noInitializeState,
      `function ScrollView() {
        const viewportRef = useRef(null);
        const [showThumb, setShowThumb] = useState(false);
        useEffect(() => {
          if (viewportRef.current) setShowThumb(viewportRef.current.scrollHeight > 0);
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the setter argument derives from matchMedia via a local", () => {
    const result = runRule(
      noInitializeState,
      `function Mode() {
        const [mode, setMode] = useState("system");
        useEffect(() => {
          const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
          setMode(mediaQuery.matches ? "dark" : "light");
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags state seeded from an uncalled measurement member reference", () => {
    const result = runRule(
      noInitializeState,
      `function Support() {
        const [hasMatchMedia, setHasMatchMedia] = useState(false);
        useEffect(() => {
          setHasMatchMedia(!!window.matchMedia);
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  // docs-validation FP wave: the doc's named FP carve-out is "SSR hydration
  // where the value must differ between server and client (window-only
  // APIs)". `window.innerWidth` cannot be hoisted into useState without
  // breaking hydration; the doc routes it to useSyncExternalStore instead.
  it("stays silent on a mount effect seeding state from scalar window size reads (react-transliterate shape)", () => {
    const result = runRule(
      noInitializeState,
      `function Helper() {
        const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });
        useEffect(() => {
          const width = window.innerWidth;
          const height = window.innerHeight;
          setWindowSize({ width, height });
        }, []);
        return <div>{windowSize.width}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

// Verify-run FP clusters (118-case dossier): same-value re-writes of the
// useState initializer, helper-function indirection hiding measurement /
// async-only writes, and destructured layout reads.
describe("no-initialize-state — same-value re-writes of the initializer stay quiet", () => {
  it("stays silent when the effect re-sets the exact useState identifier", () => {
    const result = runRule(
      noInitializeState,
      `function Field({ initialValue }) {
        const [value, setValue] = useState(initialValue ?? '');
        useEffect(() => {
          if (initialValue) {
            setValue(initialValue);
          }
        }, []);
        return <input value={value} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the effect re-sets the same literal the state starts as", () => {
    const result = runRule(
      noInitializeState,
      `function Avatar() {
        const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
        useEffect(() => {
          setAvatarLoadFailed(false);
        }, []);
        return <img data-failed={avatarLoadFailed} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a subscribe-then-resync re-reading the initializer source", () => {
    const result = runRule(
      noInitializeState,
      `function ConnectionBadge({ socket }) {
        const [connected, setConnected] = useState(socket.connected);
        useEffect(() => {
          setConnected(socket.connected);
          socket.on('connect', () => setConnected(true));
          return () => socket.off('connect');
        }, []);
        return <span>{String(connected)}</span>;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a mount effect writes undefined into argless useState", () => {
    const result = runRule(
      noInitializeState,
      `function Popup({ getContainer }) {
        const [minHeight, setMinHeight] = useState();
        useEffect(() => {
          if (!getContainer) {
            setMinHeight(undefined);
          }
        }, []);
        return <div style={{ minHeight }} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a mount write whose value differs from the initializer", () => {
    const result = runRule(
      noInitializeState,
      `function C() {
        const [count, setCount] = useState(0);
        useEffect(() => {
          setCount(42);
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("no-initialize-state — helper-function indirection", () => {
  // freecut compact-navigator: the mount effect calls an effect-local
  // helper that measures a ref'd element; ResizeObserver re-invokes it.
  it("stays silent when a helper invoked at mount writes a DOM measurement", () => {
    const result = runRule(
      noInitializeState,
      `function CompactNavigator() {
        const trackRef = useRef(null);
        const [trackWidth, setTrackWidth] = useState(0);
        useEffect(() => {
          const track = trackRef.current;
          if (!track) return;
          const updateWidth = () => {
            setTrackWidth(track.clientWidth);
          };
          updateWidth();
          const observer = new ResizeObserver(updateWidth);
          observer.observe(track);
          return () => observer.disconnect();
        }, []);
        return <div ref={trackRef} style={{ width: trackWidth }} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // internxt UsageBar: listener() measures via getBoundingClientRect.
  it("stays silent when a mount-invoked listener measures getBoundingClientRect", () => {
    const result = runRule(
      noInitializeState,
      `function UsageBar() {
        const barRef = useRef(null);
        const [barWidth, setBarWidth] = useState(0);
        useEffect(() => {
          const bar = barRef.current;
          if (bar) {
            const listener = () => {
              setBarWidth(bar.getBoundingClientRect().width);
            };
            bar.addEventListener('resize', listener);
            listener();
            return () => bar.removeEventListener('resize', listener);
          }
        }, []);
        return <div ref={barRef} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // Async data loading through a component-body helper: the setter only
  // runs in the fetch continuation, so nothing is hoistable to useState.
  it("stays silent when the mount-invoked helper only sets state after a fetch", () => {
    const result = runRule(
      noInitializeState,
      `function Backends() {
        const [regenInfo, setRegenInfo] = useState(null);
        const reloadBackends = () => {
          fetchAvailability().then((availability) => {
            setRegenInfo(availability);
          });
        };
        useEffect(() => {
          reloadBackends();
        }, []);
        return <div>{regenInfo}</div>;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a helper that synchronously writes a hoistable literal", () => {
    const result = runRule(
      noInitializeState,
      `function C() {
        const [count, setCount] = useState(0);
        useEffect(() => {
          const applyDefault = () => {
            setCount(42);
          };
          applyDefault();
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

// docs-validation FP wave (5 TP / 7 FP): every confirmed FP was an
// SSR-hydration seed (the doc's named carve-out) — window/document value
// reads, typeof-guarded initializers, mount flags reset by cleanup — or an
// imperative handler flow triggered at mount. Each case below failed
// (fired) before the corresponding guard.
describe("no-initialize-state — docs-validation FP wave", () => {
  it("stays silent on windowSize seeded from window.innerWidth (react-transliterate)", () => {
    const result = runRule(
      noInitializeState,
      `function ReactTransliterate() {
        const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });
        useEffect(() => {
          setWindowSize({ width: window.innerWidth, height: window.innerHeight });
        }, []);
        return <div data-w={windowSize.width} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on the portal mounted flag whose cleanup resets it (yet-another-react-lightbox)", () => {
    const result = runRule(
      noInitializeState,
      `function Portal({ children }) {
        const [mounted, setMounted] = useState(false);
        const [visible, setVisible] = useState(false);
        useEffect(() => {
          setMounted(true);
          return () => {
            setMounted(false);
            setVisible(false);
          };
        }, []);
        return mounted ? <div>{children}</div> : null;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a handler-named imperative flow triggered at mount (react-tooltip defaultIsOpen)", () => {
    const result = runRule(
      noInitializeState,
      `function Tooltip({ defaultIsOpen, delayShow }) {
        const [show, setShow] = useState(false);
        const [rendered, setRendered] = useState(false);
        const tooltipShowDelayTimerRef = useRef(null);
        const handleShow = (value) => {
          setRendered(true);
          if (delayShow) {
            tooltipShowDelayTimerRef.current = setTimeout(() => setShow(value), delayShow);
          } else {
            setShow(value);
          }
        };
        useEffect(() => {
          if (defaultIsOpen) {
            handleShow(true);
          }
          return () => {
            if (tooltipShowDelayTimerRef.current) {
              clearTimeout(tooltipShowDelayTimerRef.current);
            }
          };
        }, []);
        return rendered ? <div data-show={show} /> : null;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a typeof-window lazy initializer re-synced after hydration (asterdrive FileGrid)", () => {
    const result = runRule(
      noInitializeState,
      `function FileGrid() {
        const [viewportWidth, setViewportWidth] = useState(() =>
          typeof window === "undefined" ? 1280 : window.innerWidth,
        );
        useEffect(() => {
          const handleResize = () => setViewportWidth(window.innerWidth);
          handleResize();
          window.addEventListener("resize", handleResize);
          return () => window.removeEventListener("resize", handleResize);
        }, []);
        return <div data-w={viewportWidth} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on docRoot read from document.documentElement (json-edit-react)", () => {
    const result = runRule(
      noInitializeState,
      `function JsonEditor() {
        const [docRoot, setDocRoot] = useState(null);
        useEffect(() => {
          const root = document.documentElement;
          setDocRoot(root);
        }, []);
        if (!docRoot) return null;
        return <div data-root={docRoot.tagName} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on useIsClient with a typeof-document initializer (lobe-ui)", () => {
    const result = runRule(
      noInitializeState,
      `const useIsClient = () => {
        const [isClient, setIsClient] = useState(typeof document !== "undefined");
        useEffect(() => {
          if (isClient) return;
          setIsClient(true);
        }, []);
        return isClient;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on pathname read from window.location (mezzanine useCurrentPathname)", () => {
    const result = runRule(
      noInitializeState,
      `const useCurrentPathname = () => {
        const [pathname, setPathname] = useState(null);
        useEffect(() => {
          setPathname(window.location.pathname);
        }, []);
        return pathname;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a mount write of a literal true with no SSR marker anywhere", () => {
    const result = runRule(
      noInitializeState,
      `function C() {
        const [ready, setReady] = useState(false);
        useEffect(() => {
          setReady(true);
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("no-initialize-state — destructured layout reads", () => {
  // catho quantum Breadcrumbs: measurement properties destructured off a
  // ref's `.current` before feeding the setter.
  it("stays silent when the setter argument uses destructured ref measurements", () => {
    const result = runRule(
      noInitializeState,
      `function Breadcrumbs({ items }) {
        const breadcrumbsItemsEl = useRef(null);
        const [collapsed, setCollapsed] = useState(false);
        useEffect(() => {
          if (items.length > 2 && breadcrumbsItemsEl.current) {
            const { scrollWidth, clientWidth } = breadcrumbsItemsEl.current;
            setCollapsed(clientWidth < scrollWidth);
          }
        }, []);
        return <nav ref={breadcrumbsItemsEl} data-collapsed={collapsed} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
