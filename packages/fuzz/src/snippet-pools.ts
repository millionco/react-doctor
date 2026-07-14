// Snippet pools distilled from two real-world corpora: (1) React/TSX code
// that coding agents actually wrote (mined from Claude Code session traces)
// and (2) 13 production repos + oracle solutions from the react-bench
// benchmark (artsy/force, mantine, cloudscape, dtale, …). Every snippet is a
// statement that parses inside a component body and shares the common
// lexicon (state/setState, items, value, url, handle, containerRef, …) so
// independently sampled statements still form dataflow between each other —
// which is what pushes rules past their early bails into reporting paths.

// Effects — listener pairs (matched and mismatched), observers, rAF loops,
// timers, async IIFEs with and without cancellation, body mutations.
export const EFFECT_SNIPPET_POOL = [
  `useEffect(() => { const handleWheel = () => handle(); window.addEventListener("wheel", handleWheel); return () => window.removeEventListener("wheel", handleWheel); }, []);`,
  `useEffect(() => { const handleWheel = (event) => handle(event); window.addEventListener("wheel", handleWheel); return () => window.removeEventListener("wheel", handleWheel); }, []);`,
  `useEffect(() => { window.addEventListener("resize", handle); return () => window.removeEventListener("resize", handle); }, []);`,
  `useEffect(() => { window.addEventListener("scroll", handle, { passive: true, capture: true }); return () => window.removeEventListener("scroll", handle, { capture: true }); }, []);`,
  `useEffect(() => { document.addEventListener("keydown", handle); return () => document.removeEventListener("keydown", handle); }, []);`,
  `useEffect(() => { window.addEventListener("storage", handle); }, []);`,
  `useEffect(() => { document.addEventListener("mousedown", (event) => handle(event)); return () => document.removeEventListener("mousedown", (event) => handle(event)); }, []);`,
  `useEffect(() => { const media = window.matchMedia("(prefers-color-scheme: dark)"); media.addListener(handle); return () => media.removeListener(handle); }, []);`,
  `useEffect(() => { const observer = new ResizeObserver(handle); if (containerRef.current) observer.observe(containerRef.current); return () => observer.disconnect(); }, []);`,
  `useEffect(() => { const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) handle(); }, { threshold: 0.2 }); observer.observe(containerRef.current); }, []);`,
  `useEffect(() => { const observer = new MutationObserver(handle); observer.observe(document.body, { childList: true, subtree: true }); return () => observer.disconnect(); }, []);`,
  `useEffect(() => { let rafId; const loop = () => { handle(); rafId = requestAnimationFrame(loop); }; rafId = requestAnimationFrame(loop); return () => cancelAnimationFrame(rafId); }, []);`,
  `useEffect(() => { const loop = () => { handle(); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }, []);`,
  `useEffect(() => { const id = setInterval(() => setState((prev) => prev + 1), 1000); return () => clearInterval(id); }, []);`,
  `useEffect(() => { const id = window.setTimeout(() => setState(0), 500); return () => window.clearTimeout(id); }, [value]);`,
  `useEffect(() => { let cancelled = false; const load = async () => { const result = await fetch(url); if (!cancelled) setState(await result.json()); }; load(); return () => { cancelled = true; }; }, [url]);`,
  `useEffect(() => { (async () => { const result = await fetch(url); setState(await result.json()); })(); }, [url]);`,
  `useEffect(() => { const controller = new AbortController(); fetch(url, { signal: controller.signal }).catch(() => {}); return () => controller.abort(); }, [url]);`,
  `useEffect(() => { fetch(url).then((response) => response.json()).then(setState); }, [url]);`,
  `useEffect(() => { fetch(url).then((response) => response.json()).then(setState).catch(handle); }, [url]);`,
  `useEffect(() => { document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = ""; }; }, []);`,
  `useEffect(() => { if (isOpen) { document.body.classList.add("modal-open"); } return () => document.body.classList.remove("modal-open"); }, [isOpen]);`,
  `useEffect(() => { document.title = String(state); }, [state]);`,
  `useEffect(() => { setState(value); }, [value]);`,
  `useEffect(() => { if (value) { handle(value); } }, [value]);`,
  `const CallbackRefChild = ({ onSelect }) => { const callbackRef = useRef(onSelect); callbackRef.current = onSelect; const childData = buildPhoneData(); useEffect(() => { callbackRef.current(childData); }, [childData]); return null; };`,
  `useEffect(() => { const debounced = debounce(() => handle(value), 300); debounced(); return () => debounced.cancel(); }, [value]);`,
  `useEffect(() => { const unsubscribe = store.subscribe(handle); return unsubscribe; }, []);`,
  `useEffect(() => store.subscribe(handle), []);`,
  `const activeSessionRef = useRef(null); const stopSession = useCallback(() => { const session = activeSessionRef.current; if (!session) return; document.removeEventListener("mousemove", session.handleMouseMove); activeSessionRef.current = null; }, []); useEffect(() => stopSession, [stopSession]); const startSession = useCallback(() => { stopSession(); const handleMouseMove = () => {}; activeSessionRef.current = { handleMouseMove }; document.addEventListener("mousemove", handleMouseMove); }, [stopSession]);`,
  `useLayoutEffect(() => { const rect = containerRef.current?.getBoundingClientRect(); if (rect) setState(rect.width); }, []);`,
  `useEffect(() => { const objectUrl = URL.createObjectURL(blob); setState(objectUrl); return () => URL.revokeObjectURL(objectUrl); }, [blob]);`,
  `const outsideActionEvents = ["mousedown", "focusin", "touchstart"] as const; useEffect(() => { for (const event of outsideActionEvents) document.addEventListener(event, handle); return () => { for (const event of outsideActionEvents) document.removeEventListener(event, handle); }; }, [handle]);`,
  `const guardedEvents = ["mousedown", "focusin"] as const; useEffect(() => { for (const event of guardedEvents) document.addEventListener(event, handle); return () => { for (const event of guardedEvents) if (enabled) document.removeEventListener(event, handle); }; }, [enabled, handle]);`,
  `const mutableHandlerEvents = ["mousedown", "focusin"] as const; useEffect(() => { const setupHandler = handlers.current; for (const event of mutableHandlerEvents) document.addEventListener(event, setupHandler); handlers.current = nextHandler; const cleanupHandler = handlers.current; return () => { for (const event of mutableHandlerEvents) document.removeEventListener(event, cleanupHandler); }; }, [handlers, nextHandler]);`,
  `const setupEvents = ["mousedown", "focusin"] as const; const cleanupEvents = ["keydown"] as const; useEffect(() => { let event; for (event of setupEvents) document.addEventListener(event, handle); return () => { for (event of cleanupEvents) document.removeEventListener(event, handle); }; }, [handle]);`,
  `const onTick = useEffectEvent(() => handle(value)); useEffect(() => { onTick(); }, [onTick]);`,
  `const [, setOpen] = useState(false); const stableHandle = useCallback(() => setOpen(true), [setOpen]); useEffect(() => { const timeoutId = setTimeout(() => stableHandle(), 100); return () => clearTimeout(timeoutId); }, [stableHandle, value]);`,
  `const deferredHandle = useCallback(() => handle(value), [value]); useEffect(() => { const timeoutId = setTimeout(() => deferredHandle(), 100); return () => clearTimeout(timeoutId); }, [deferredHandle, value]);`,
  `const [didSubmit, setDidSubmit] = useState(false); useEffect(() => { if (didSubmit) handle(value); }, [didSubmit, value]); const eventRelayButton = <button onClick={() => setDidSubmit(true)}>Submit</button>;`,
  `const [phase, setPhase] = useState(""); const [total, setTotal] = useState(0); const [ready, setReady] = useState(false); useEffect(() => { setPhase("sync"); setTotal(items.length); setReady(true); }, [items]);`,
  `const [snapshot, setSnapshot] = useState(sharedSnapshot); useEffect(() => subscribeSnapshot(setSnapshot), []);`,
  `const [guardedSnapshot, setGuardedSnapshot] = useState(value); useEffect(() => { if (!Object.is(guardedSnapshot, value)) setGuardedSnapshot(value); }, [value]);`,
  `const equalSnapshots = () => false; const [namedGuardSnapshot, setNamedGuardSnapshot] = useState(value); useEffect(() => { if (!equalSnapshots(namedGuardSnapshot, value)) setNamedGuardSnapshot(value); }, [value]);`,
  `const [mismatchedSnapshot, setMismatchedSnapshot] = useState(value); useEffect(() => { if (mismatchedSnapshot !== value) setMismatchedSnapshot(state); }, [state, value]);`,
  `const directoryStore = useDirectoryStore(); const directorySnapshot = directoryStore(); const nextDirectory = directorySnapshot.path.directory; useEffect(() => { if (props.draftId) return; const next = nextDirectory; if (!next || next === props.directory) return; navigate(encodeDirectory(next), { replace: true }); }, [props.draftId, props.directory, nextDirectory, navigate]);`,
  `useFuzzDocumentEvents(() => handle(value), [value]);`,
  `const fuzzDocumentEventArguments = condition ? [] : [() => handle(value), [value]]; useFuzzDocumentEvents(...fuzzDocumentEventArguments);`,
  `const fuzzDocumentEventOptions = { callback: () => handle(value) }; fuzzDocumentEventOptions.callback = handle; useFuzzDocumentEventOptions(fuzzDocumentEventOptions);`,
] as const;

// State — lazy initializers (incl. SSR-hazardous localStorage/matchMedia),
// toggles, loading triples, prop mirrors, reducers, ref-sync.
export const STATE_SNIPPET_POOL = [
  `const FuzzNestedPanel = () => <div>nested</div>; const fuzzNestedPanelNode = <FuzzNestedPanel />;`,
  `const [state, setState] = useState(0);`,
  `const [state, setState] = useState(() => Number(localStorage.getItem("count") ?? 0));`,
  `const [theme, setTheme] = useState(() => (typeof window === "undefined" ? "light" : (localStorage.getItem("theme") ?? "light")));`,
  `const [isDark, setIsDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);`,
  `const [isOpen, setIsOpen] = useState(false);`,
  `const [values, setValues] = useState({ title: "", description: "" });`,
  `const [selected, setSelected] = useState<string[]>([]);`,
  `const [loading, setLoading] = useState(false); const [error, setError] = useState(null); const [data, setData] = useState(null);`,
  `const [internalValue, setInternalValue] = useState(value); useEffect(() => { setInternalValue(value); }, [value]);`,
  `const [previousValue, setPreviousValue] = useState(Boolean(value)); useEffect(() => { setPreviousValue(Boolean(value)); }, [value]);`,
  `const [resetDraft, setResetDraft] = useState(""); useEffect(() => { setResetDraft(""); }, [value]);`,
  `const [reducerState, dispatch] = useReducer(reducer, { count: 0 });`,
  `const containerRef = useRef(null);`,
  `const handleRef = useRef(handle); handleRef.current = handle;`,
  `const [copied, setCopied] = useState(false);`,
  `const [cache] = useState(new Map());`,
  `const [snapshot] = useState(new Date());`,
  `const id = useId();`,
  `const deferredValue = useDeferredValue(state);`,
  `const [isPending, startTransition] = useTransition();`,
  `const [counterState, dispatchCounter] = useReducer((state, action) => { state.count += 1; return state; }, { count: 0 });`,
  `const [persistedCount, setPersistedCount] = useState(0); const incrementPersistedCount = () => setPersistedCount((previousCount) => { localStorage.setItem("count", String(previousCount + 1)); return previousCount + 1; });`,
  `const [parsedItems, setParsedItems] = useState(parseItems(value));`,
  `const indexRef = useRef(buildIndex(items));`,
  `const doubled = useMemo(() => state * 2, [state]);`,
] as const;

// Handlers — async submits with loading flags, keyboard commit paths,
// numeric input parsing, window.open, clipboard, toggles.
export const HANDLER_SNIPPET_POOL = [
  `const handleSyncRequest = () => { const request = new XMLHttpRequest(); request.open("GET", String(url), false); request.send(); };`,
  `const handleSubmit = async () => { setLoading(true); try { await fetch(url, { method: "POST", body: JSON.stringify(values) }); setState(true); } catch (submitError) { setError(submitError); } finally { setLoading(false); } };`,
  `const handleSubmit = async () => { setLoading(true); const result = await api.post(url, values); setState(result); setLoading(false); };`,
  `const handleSave = async () => { if (loading) return; setLoading(true); await api.put(url, values); setLoading(false); };`,
  `const handleClick = () => { setIsOpen(!isOpen); };`,
  `const handleClick = () => { setIsOpen((prev) => !prev); };`,
  `const handleChange = (event) => { setState(event.target.value); };`,
  `const handleChange = (event) => { const { name, value: fieldValue } = event.target; setValues((prev) => ({ ...prev, [name]: fieldValue })); };`,
  `const handleAmount = (event) => { setState(Number(event.target.value)); };`,
  `const handleAmount = (event) => { const parsed = parseInt(event.target.value, 10); if (!Number.isNaN(parsed)) setState(parsed); };`,
  `const handleKeyDown = (event) => { if (event.key === "Enter") { handleSubmit(); } else if (event.key === "Escape") { setIsOpen(false); } };`,
  `const handleKeyDown = (event) => { if (event.nativeEvent.isComposing) return; if (event.key === "Enter") handleSubmit(); };`,
  `const handleKeyDown = (event) => { if (event.keyCode === 13) { handleSubmit(); } };`,
  `const handleOpen = () => { window.open(url, "_blank"); };`,
  `const handleOpen = () => { window.open(url, "_blank", "noopener,noreferrer"); };`,
  `const handleOpen = () => { window.open(\`\${window.location.origin}/report/\${value}\`, "_blank"); };`,
  `const handleCopy = () => { void navigator.clipboard.writeText(String(value)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };`,
  `const handleDownload = () => { const objectUrl = URL.createObjectURL(new Blob([String(value)])); const anchor = document.createElement("a"); anchor.href = objectUrl; anchor.click(); };`,
  `const handleRetry = () => { fetch(url).then((response) => response.json()).then(setState); };`,
  `const handleSort = () => { setSelected(items.sort()); };`,
  `const handleSort = () => { setSelected([...items].sort()); };`,
  `const handleReset = () => { const next = { ...values }; next.title = ""; setValues(next); };`,
  `const handleMutate = () => { values.title = "changed"; setValues(values); };`,
  `const handleAsyncToggle = () => { setTimeout(() => setIsOpen(!isOpen), 100); };`,
  `const timerRef = useRef(null); const handleSchedule = () => { if (timerRef.current) return; timerRef.current = setTimeout(() => { timerRef.current = null; handle(); }, 300); }; const handleCancel = () => { if (timerRef.current) { clearTimeout(timerRef.current); } };`,
  `const timerRef = useRef(null); const handleQueue = () => { clearTimeout(timerRef.current); timerRef.current = setTimeout(handle, 250); }; const handleFlush = () => { clearTimeout(timerRef.current); timerRef.current = null; handle(); };`,
  `const handleBatch = async () => { for (const item of items) { await api.post(url, item); } };`,
  `const handleBatch = async () => { await Promise.all(items.map((item) => api.post(url, item))); };`,
  `const query = async (item) => { await Promise.resolve(); return item * 2; }; const handleQueries = async () => { for (const item of items) { await query(item); } };`,
  `const doubleCell = async (cell) => { await Promise.resolve(); cell.value *= 2; }; const handleCells = async () => { await doubleCell(items[0]); await doubleCell(items[1]); await doubleCell(items[2]); };`,
  `let escapedCursor = 0; const escapedQuery = async (item) => { await Promise.resolve(); return item * 2; }; const escapedHelpers = { escapedQuery }; Object.assign(escapedHelpers, { escapedQuery: async (item) => { const previousCursor = escapedCursor; await Promise.resolve(); escapedCursor = previousCursor + item; return escapedCursor; } }); const handleEscapedQueries = async () => { await escapedHelpers.escapedQuery(items[0]); await escapedHelpers.escapedQuery(items[1]); await escapedHelpers.escapedQuery(items[2]); };`,
  `const observedCellValues = []; const observedCell = { value: 1 }; const getObservedCell = () => { observedCellValues.push(observedCell.value); return observedCell; }; const doubleObservedCell = async (cell) => { await Promise.resolve(); cell.value *= 2; }; const handleObservedCell = async () => { await doubleObservedCell(getObservedCell()); await doubleObservedCell(getObservedCell()); await doubleObservedCell(getObservedCell()); };`,
  `const queryItem = async (item) => { await Promise.resolve(); return item * 2; }; const queryHelpers = { queryItem }; const handleMixedQueries = async () => { await queryItem(items[0]); await queryHelpers.queryItem(items[1]); await queryHelpers["queryItem"](items[2]); };`,
  `const mutableQuery = async (item) => { await Promise.resolve(); return item * 2; }; const mutableQueryHelpers = { mutableQuery }; let mutableQueryHolder = mutableQueryHelpers; const nestedMutableQueryHolder = mutableQueryHolder; nestedMutableQueryHolder.mutableQuery = async (item) => item + 1; const handleMutableQueries = async () => { await mutableQuery(items[0]); await mutableQueryHelpers.mutableQuery(items[1]); await mutableQuery(items[2]); };`,
  `const handleMatch = () => { for (const item of items) { new RegExp("token", "i").test(String(item)); } };`,
  `const handleStatefulMatch = () => { for (const item of items) { new RegExp("token", "g").test(String(item)); } };`,
  `const handleReplaceAll = (text: string) => { for (const item of items) { text.replaceAll(new RegExp("token", "g"), String(item)); } };`,
  `globalThis.RegExp = CustomRegExp; const handleCustomMatch = () => { for (const item of items) { new RegExp("token", "i").test(String(item)); } };`,
  `const handleSequence = async () => { const first = await fetch(url); const second = await fetch(url); handle(first, second); };`,
  `const handlePersistToken = () => { localStorage.setItem("auth_token", String(value)); };`,
  `const handleRedirect = () => { window.location.href = String(params.next); };`,
  `const renderStatus = () => { const [open] = useState(false); return <b>{String(open)}</b>; }; const statusNode = <div>{renderStatus()}</div>;`,
  `const FuzzMemoRenderContent = () => <div>{state}</div>; const fuzzMemoContent = useMemo(FuzzMemoRenderContent, [state]);`,
  `const FuzzNestedComponent = () => <div>{state}</div>; const fuzzNestedElement = <FuzzNestedComponent />;`,
] as const;

// Guards / nullability — find/match/get derefs, optional chains, splits,
// alias-then-guard, canUseDOM aliases, JSON.parse.
export const GUARD_SNIPPET_POOL = [
  `const found = items.find((item) => item.id === value); if (!found) return null;`,
  `const label = items.find((item) => item.active)?.name ?? "none";`,
  `const first = items.find((item) => item.active)!.name;`,
  `const matched = String(value).match(/v(\\d+)/); const version = matched ? matched[1] : null;`,
  `const version = String(value).match(/v(\\d+)/)![1];`,
  `const parts = String(value).split(":"); const minutes = parts[1] ?? "0";`,
  `const minutes = String(value).split(":")[1];`,
  `const total = config?.price * 2;`,
  `const total = (config?.price ?? 0) * 2;`,
  `const price = config?.price; if (!price) return null; const doubled = price * 2;`,
  `const keys = Object.keys(config ?? {});`,
  `const entries = Object.entries(config);`,
  `if (!items.length) return null;`,
  `if (value) onSelect(value);`,
  `if (items.length === 0) { return <p>No items</p>; }`,
  `const parsed = JSON.parse(String(value)).settings;`,
  `let parsed = {}; try { parsed = JSON.parse(String(value)); } catch { parsed = {}; }`,
  `const cached = cache.get(value); if (cached !== undefined) return cached;`,
  `const decoded = decodeURIComponent(String(params.slug));`,
  `const parsedUrl = new URL(String(value));`,
  `const matcher = new RegExp(searchTerm, "i");`,
  `const escaped = searchTerm.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&"); const safeMatcher = new RegExp(escaped, "i");`,
  `const width = canUseDOM ? window.innerWidth : 0;`,
  `const width = typeof window === "undefined" ? 0 : window.innerWidth;`,
  `const node = document.querySelector("#root"); node?.classList.add("ready");`,
  `const rectTop = containerRef.current.getBoundingClientRect().top; const rectBottom = containerRef.current.getBoundingClientRect().bottom;`,
  `const summary = \`items: \${items}\`;`,
  `const merged = { ...defaults, ...props };`,
  `const flattened = items.reduce((accumulator, item) => [...accumulator, ...item.children], []);`,
  `const lookup = items.reduce((accumulator, item) => ({ ...accumulator, [item.id]: item }), {});`,
  `const smallestValue = [3, 1, 2].sort((leftValue, rightValue) => leftValue - rightValue)[0];`,
] as const;

// Library idioms — tanstack, mobx, styled-components, next/dynamic, redux.
export const LIBRARY_SNIPPET_POOL = [
  `const zodSchema = z.object({ value: z.string() }).strict();`,
  `const subscribeStore = useCallback((onStoreChange) => { store.on("change", onStoreChange); return () => store.off("change", onStoreChange); }, [store]); const snapshot = useSyncExternalStore(subscribeStore, getSnapshot);`,
  `const { data: queryData, isPending } = useQuery({ queryKey: ["items", value], queryFn: () => fetch(url).then((response) => response.json()) });`,
  `const queryResult = useQuery({ queryKey: ["items", value], queryFn: () => fetch(url).then((response) => response.json()) }); useEffect(() => { queryResult["refetch"](); }, [queryResult]);`,
  `const wrappedQueryResult = (ReactQuery as typeof ReactQuery)[\`useQuery\`]({ queryKey: ["wrapped", value] }); useEffect(() => { wrappedQueryResult.refetch(); }, [wrappedQueryResult]);`,
  `const overwrittenQuery = useQuery({ queryKey: ["overwritten", value] }); useEffect(() => { overwrittenQuery.refetch(); }, [overwrittenQuery]); try { handle(value); } catch { handle(value); } finally { overwrittenQuery.refetch = handle; }`,
  `const conditionallyOverwrittenQuery = useQuery({ queryKey: ["conditional", value] }); const overwriteQueryRefetch = () => { conditionallyOverwrittenQuery.refetch = handle; }; useEffect(() => { conditionallyOverwrittenQuery.refetch(); }, [conditionallyOverwrittenQuery]); value && overwriteQueryRefetch();`,
  `const searchIndex = { refetch: () => handle(value) }; useEffect(() => { searchIndex.refetch(); }, [searchIndex]);`,
  `const mutation = useMutation({ mutationFn: (payload) => api.post(url, payload) });`,
  `const { mutate, mutateAsync } = useMutation({ mutationFn: (payload) => api.post(url, payload) });`,
  `useEffect(() => { mutateAsync({ event: "view" }); }, []);`,
  `useEffect(() => { reaction(() => store.value, (next) => handle(next)); }, []);`,
  `const dispatchAction = useDispatch(); const storeValue = useSelector((appState) => appState.items.map((item) => item.id));`,
  `const [searchParams, setSearchParams] = useSearchParams();`,
  `const navigate = useNavigate();`,
  `const form = useForm({ defaultValues: values });`,
] as const;

// Module scope — SSR hazards, guard aliases, contexts, caches, styled.
export const MODULE_SCOPE_SNIPPET_POOL = [
  `import { motion as FuzzMotion } from "framer-motion"; export const FuzzMotionPanel = () => <FuzzMotion.div animate={{ x: 120 }}>moving</FuzzMotion.div>;`,
  `import { createRoot as mountFuzzRoot } from "react-dom/client"; export const FuzzRootApp = () => <div />; export const fuzzRootConfig = getConfig(); const fuzzApplicationRoot = mountFuzzRoot(document.body); fuzzApplicationRoot.render(<FuzzRootApp />);`,
  `const GLOBAL_CACHE = new Map<string, unknown>();`,
  `class FuzzProtocolRegistry { static contextTypes = new Set(["json", "text"]); static childContextTypes = new Map(); getChildContext() { return { protocol: "json" }; } } const FuzzSchemaRegistry = {}; FuzzSchemaRegistry.contextTypes = new Set(["json", "text"]);`,
  `const fuzzLeftItems = ["a", "b"]; const fuzzRightItems = ["a", "b"]; const fuzzItemsMatch = fuzzLeftItems.every((item, index) => item === fuzzRightItems[index]);`,
  `const FuzzLargeTextThreshold = 50_000; const FuzzLargeTextCodeBlock = ({ children }) => { if (typeof children === "string" && children.length > FuzzLargeTextThreshold) return <VirtualizedCode text={children} />; return <pre>{children}</pre>; }; const FuzzPolymorphicChildPanel = ({ children }) => typeof children === "string" ? <span>{children}</span> : <div>{children}</div>;`,
  `const FuzzMemoList = React.memo(({ items }) => <div>{items.length}</div>, (previousProps, nextProps) => previousProps.items.length === nextProps.items.length); const FuzzDefaultList = ({ items = [] }) => <FuzzMemoList items={items} />;`,
  `const FuzzPropTypesPanel = ({ value }) => <div>{value}</div>; FuzzPropTypesPanel.propTypes = { value: () => true };`,
  `function FuzzNestedWritePanel() { return <div />; } function unusedFuzzNestedWrite() { FuzzNestedWritePanel = () => null; } FuzzNestedWritePanel.propTypes = { value: () => true };`,
  `function FuzzReturnedLabel() { let output = "label"; function unusedFuzzOutputWrite() { output = <div />; } return output; } FuzzReturnedLabel.propTypes = { value: () => true };`,
  `function FuzzExitedWrite(condition: boolean) { let output; if (condition) { output = <div />; return "label"; } return output; } FuzzExitedWrite.propTypes = { value: () => true };`,
  `const FuzzRenamedChildrenPanel = ({ children: content = null }) => content; FuzzRenamedChildrenPanel.propTypes = { children: () => true };`,
  `const FuzzNestedChildrenSchema = ({ children: { value } }) => value; FuzzNestedChildrenSchema.propTypes = { value: () => true };`,
  `const FuzzReassignedChildrenSchema = ({ children }) => { children = { value: true }; return children; }; FuzzReassignedChildrenSchema.propTypes = { value: () => true };`,
  `const FuzzCallbackSchema = (items) => items.some((item) => <span>{item}</span>); FuzzCallbackSchema.propTypes = { value: () => true };`,
  `let moduleMutableState = 0;`,
  `const ThemeContext = React.createContext({ mode: "light" });`,
  `const ItemsContext = React.createContext(null);`,
  `export const DynamicChart = dynamic(() => import("./chart"), { ssr: false });`,
  `const canUseDOM = typeof window !== "undefined";`,
  `const isServer = typeof window === "undefined";`,
  `const INITIAL_WIDTH = typeof window !== "undefined" ? window.innerWidth : 0;`,
  `const STARTUP_TIMESTAMP = Date.now();`,
  `const RENDERED_AT = Date.now();`,
  `const SESSION_SEED = Math.random();`,
  `const USER_AGENT = typeof navigator === "undefined" ? "" : navigator.userAgent;`,
  `const StyledButton = styled.button\`color: \${(styledProps) => (styledProps.$active ? "red" : "gray")};\`;`,
  `const StyledInput = styled.input<{ $error: boolean }>\`border: 1px solid \${(styledProps) => (styledProps.$error ? "red" : "gray")}; border: 2px dashed blue;\`;`,
  `const SECRET_KEY = "sk-live-abc123def456ghi789jkl012mno345";`,
  `const ARROW_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);`,
  `export const STATIC_STYLED_ELEMENT = <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", flexDirection: "column", backgroundColor: "white", fontSize: 64 }} />;`,
  `const defaults = { title: "untitled", pageSize: 20 };`,
  `reaction(() => store.value, (next) => persist(next));`,
  `let sharedSnapshot = "idle"; const snapshotListeners = new Set(); function subscribeSnapshot(listener) { snapshotListeners.add(listener); return () => snapshotListeners.delete(listener); }`,
  `const useFuzzDocumentEvents = (callback = () => {}, dependencies = []) => { useEffect(() => callback(), [callback, dependencies]); };`,
  `const useFuzzDocumentEventOptions = ({ callback }) => { useEffect(callback, [callback]); };`,
  `const FuzzPolyfillScript = () => <script src="https://polyfill.io/v3/polyfill.min.js" />;`,
  `import FuzzRawMarkdown from "react-markdown"; import fuzzRawPlugin from "rehype-raw"; export const FuzzRawMarkdownPreview = ({ value }) => <FuzzRawMarkdown rehypePlugins={[fuzzRawPlugin]}>{String(value)}</FuzzRawMarkdown>;`,
] as const;

export const SERVER_MODULE_PROGRAM_POOL = [
  `const initializeProfile = async (value: number) => { await Promise.resolve(); return value * 2; };
const loadPreferences = async (value: number) => { await Promise.resolve(); return value * 3; };
export const loadProfile = async () => {
  const profile = await initializeProfile(2);
  const preferences = await loadPreferences(3);
  return { profile, preferences };
};`,
  `"use server";
const state = Object.seal({ count: 0 });
export const increment = async () => {
  state.count++;
};`,
  `"use server";
const state = Object.preventExtensions({ users: [] });
export const addUser = async (user: unknown) => {
  state.users.push(user);
};`,
  `"use server";
const state = Object.seal({ cache: new Map<string, unknown>() });
export const remember = async (key: string, value: unknown) => {
  state.cache.set(key, value);
};`,
  `"use server";
const state = Object.seal({ count: 0 });
const incrementState = (target: { count: number }) => {
  target.count++;
};
export const increment = async () => {
  incrementState(state);
};`,
  `"use server";
const state = Object.seal({ count: 0 });
export const update = async (patch: { count?: number }) => {
  Object.assign(state, patch);
};`,
  `"use server";
const state = Object.preventExtensions({ count: 0 });
export const removeCount = async () => {
  delete state.count;
};`,
  `"use server";
const state = Object.freeze({ count: 0 });
export const increment = async () => {
  state.count++;
};`,
  `"use server";
const state = Object.seal({ get count() { return 0; } });
export const increment = async () => {
  state.count++;
};`,
  `"use server";
const state = Object.preventExtensions({ count: 0 });
state.count = 1;
export const read = async () => state.count;`,
  `"use server";
const state = Object.seal({ service: getService() });
export const update = async () => {
  state.service.set("status", "active");
};`,
  `"use server";
const state = Object.seal({ service: { set(value: string) { persist(value); } } });
export const update = async () => {
  state.service.set("active");
};`,
  `"use server";
const Object = { seal: <Value,>(value: Value) => value };
const state = Object.seal({ count: 0 });
export const increment = async () => {
  state.count++;
};`,
] as const;

// Attributes that specifically trip a11y validity rules — misspelled aria
// props, invalid roles, wrong-typed values, missing pairings.
export const A11Y_TRIGGER_ATTRIBUTE_POOL = [
  `role="datepicker"`,
  `role="presentation"`,
  `aria-labeledby={id}`,
  `aria-checked="sometimes"`,
  `aria-hidden={state}`,
  `aria-activedescendant={id}`,
  `autoComplete="emial"`,
  `autoComplete="off"`,
  `accessKey="h"`,
  `contentEditable`,
  `tabIndex={3}`,
  `onMouseOver={handle}`,
  `onScroll={handle}`,
  `checked={isChecked}`,
  `role="switch"`,
  `role="dialog"`,
  `aria-hidden="true" tabIndex={0}`,
] as const;

// JSX attributes — a11y, keys, handlers, security-relevant props.
export const JSX_ATTRIBUTE_POOL = [
  `role="button"`,
  `role={dynamicRole}`,
  `aria-hidden="true"`,
  `aria-label={label}`,
  `aria-label={\`Remove \${value}\`}`,
  `alt=""`,
  `alt={altText}`,
  `href="#"`,
  `href={url}`,
  `target="_blank"`,
  `target="_blank" rel="noopener noreferrer"`,
  `tabIndex={-1}`,
  `tabIndex={2}`,
  `onClick={() => handle()}`,
  `onClick={handleClick}`,
  `onClick={() => window.open(url, "_blank")}`,
  `onClick={() => fetch(url).then(setState)}`,
  `onKeyDown={handleKeyDown}`,
  `onChange={handleChange}`,
  `onMouseEnter={() => setIsOpen(true)}`,
  `style="color: red"`,
  `style={{ color: "red" }}`,
  `style={{ width: state }}`,
  `classList={{ active: isOpen }} style={\`left: \${state}px\`}`,
  `style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", flexDirection: "column", backgroundColor: "white", fontSize: 64 }}`,
  `key={index}`,
  `key={item.id}`,
  `key={Math.random()}`,
  `dangerouslySetInnerHTML={{ __html: value }}`,
  `{...restProps}`,
  `data-testid="fuzz"`,
  `className={\`btn \${variant}\`}`,
  `checked={isChecked}`,
  `defaultValue={value}`,
  `disabled={loading}`,
  `autoFocus`,
  `title={label}`,
  `loading="lazy"`,
] as const;

// JSX leaves — conditional renders (incl. the leaked-0 shape), controlled
// inputs, radios, providers, portals, list keys.
export const JSX_LEAF_POOL = [
  `{state}`,
  `{items.map((item, index) => <li key={index}>{item}</li>)}`,
  `{items.map((item) => <li key={item.id}>{item.name}</li>)}`,
  `{Array.from({ length: 4 }).map((_, index) => <div key={index}>{index}</div>)}`,
  `{Array(3).fill(null).map((cell) => <td key={cell}>{cell}</td>)}`,
  `text content`,
  `{condition ? <span>yes</span> : null}`,
  `{condition && <em>maybe</em>}`,
  `{items.length && <span>has items</span>}`,
  `{items.length > 0 && <span>has items</span>}`,
  `{loading ? <span>Loading…</span> : <span>{String(state)}</span>}`,
  `{error && <span role="alert">{String(error)}</span>}`,
  `{...items}`,
  `<>{state}</>`,
  `<input value={state} onChange={handleChange} />`,
  `<input value={state} onChange={(event) => setState(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") handle(); }} />`,
  `<input value="frozen" onChange={handleChange} />`,
  `<input type="checkbox" checked={isChecked} onChange={(event) => setState(event.target.checked)} />`,
  `<input type="checkbox" indeterminate />`,
  `<input type="radio" value="a" checked={state === "a"} onChange={() => setState("a")} />`,
  `<input type="radio" name="group" value="b" defaultChecked />`,
  `<input type="number" min={0} max={100} value={state} onChange={handleAmount} />`,
  `<textarea readOnly value={String(value)} />`,
  `<ThemeContext.Provider value={{ mode: state, toggle: handle }}>{state}</ThemeContext.Provider>`,
  `<ItemsContext.Provider value={items}>{state}</ItemsContext.Provider>`,
  `{createPortal(<div>{state}</div>, document.body)}`,
  `<div dangerouslySetInnerHTML={{ __html: value }} />`,
  `<img src={url} />`,
  `<a href={url} target="_blank">external</a>`,
  `<StyledButton $active={isOpen} customFlag={state}>{state}</StyledButton>`,
  `<DynamicChart width={typeof window === "undefined" ? 0 : window.innerWidth} />`,
  `<a href={url}></a>`,
  `<a href="#">click here</a>`,
  `<button onClick={handleClick}>Click here…</button>`,
  `<div onClick={condition ? undefined : () => setIsOpen(true)}>{!condition && <Button aria-label="Open" onPress={() => setIsOpen(true)}>Open</Button>}</div>`,
  `<button>Submit — now...</button>`,
  `<h2></h2>`,
  `<img src={url} onError={(event) => { event.currentTarget.src = "/fallback.png"; }} />`,
  `<div role="button" onClick={handleClick}>{state}</div>`,
  `<div style={{ paddingLeft: 8, paddingRight: 8, width: 100, height: 100 }}>{state}</div>`,
  `<div style={{ marginTop: 4, marginBottom: 4 }}>{state}</div>`,
  `<div style={{ backgroundColor: "#000", boxShadow: "0 0 60px rgb(255 0 0 / 0%)" }}>{state}</div>`,
  `<div style={{ backgroundColor: "#000", boxShadow: "0 0 60px rgb(255 0 0 / 10%)" }}>{state}</div>`,
  `<input type="checkbox" checked={isChecked} />`,
  `<video autoPlay />`,
  `<marquee>{state}</marquee>`,
  `<iframe src={url} />`,
  `<time>{new Date(value).toLocaleString()}</time>`,
  `<span>{new Intl.DateTimeFormat().format(state)}</span>`,
  `<time>{new Intl.DateTimeFormat("en-US", localeOptionsAlias).format(new Date(value))}</time>`,
  `<FuzzMarkdown rehypePlugins={[fuzzRehypeRaw]}>{String(value)}</FuzzMarkdown>`,
] as const;

// Rare-but-parseable weirdness kept from the original generator, plus
// trace-mined oddities (unicode, globalThis gymnastics, labels).
export const EDGE_CASE_STATEMENT_POOL = [
  `const contextCallback = config.onSelect; const effectiveCallback = onSelect ?? contextCallback; const derivedHandler = useCallback(() => effectiveCallback?.(), [effectiveCallback]);`,
  `const membershipCandidates = [1, 2, 3, 4, 5, 6, 7, 8, 9]; const membershipValues = [1, 2, 3, 4, 5, 6, 7, 8, 9]; for (const membershipCandidate of membershipCandidates) { membershipValues.includes(membershipCandidate); }`,
  `const numericMembershipValues: number[] = []; const numericMembershipAllowed: number[] = []; numericMembershipValues.reduce((count, value) => numericMembershipAllowed.indexOf(value) !== -1 ? count + 1 : count, 0);`,
  `class NumericMembershipCollection<Value extends number> { retain(candidates: Value[], allowed: Value[]) { return candidates.filter((candidate) => allowed.indexOf(candidate) !== -1); } }`,
  `const localeOptionsBase = { timeZone: "UTC" }; const localeOptionsAlias = localeOptionsBase; const { timeZone: localeTimeZone } = localeOptionsAlias;`,
  `const useState = () => [0, () => {}] as const;`,
  `const { useEffect: renamedEffect } = React;`,
  `const { onConfirm, onCancel } = props;`,
  `const shadowed = (useMemo: () => void) => useMemo();`,
  `const conditionalHook = () => { if (Math.random() > 0.5) { useState(0); } };`,
  `function* generatorWithHookName() { yield useRef; }`,
  `const nested = () => () => () => useCallback(() => {}, []);`,
  `const computed = { ["use" + "State"]: 1 };`,
  `const optional = config?.nested?.[key]?.();`,
  `const asserted = (value as unknown as { deep: string }).deep!;`,
  `enum Direction { Up, Down }`,
  `type Recursive<T> = { child: Recursive<T> } | T;`,
  `const satisfied = { mode: "dark" } satisfies { mode: string };`,
  `label: for (let index = 0; index < 3; index += 1) { continue label; }`,
  `const tagged = html\`<div onclick="\${value}"></div>\`;`,
  `export default class extends React.Component { render() { return null; } }`,
  `export function FuzzPortalComponent(): JSX.Element | null { const portalContent = <div />; return createPortal(portalContent, document.body); }`,
  `export function FuzzNullComponent(): null { return null; } export default FuzzNullComponent;`,
  `export const FuzzCard = () => <div />; const FormatCurrency = (value: number) => String(value); export default FormatCurrency;`,
  `class EventShield extends React.Component { handleClick(event) { event.stopPropagation(); } render() { return <div onClick={this.handleClick} />; } }`,
  `const globalCount = (globalThis as any).__count = ((globalThis as any).__count ?? 0) + 1;`,
  `const emDash = \`\${value} — \${state}\`;`,
  `const composed = event.composedPath()[0];`,
  `const typedRows = items.map((row) => row.name).filter((name): name is string => Boolean(name));`,
  `void navigator.clipboard.writeText("copy");`,
  `eval(String(value));`,
  `const query = \`SELECT * FROM users WHERE id = \${value}\`;`,
  `const rawHtml = "<b>" + value + "</b>";`,
] as const;

export const IMPORT_LINE_POOL = [
  `import { motion, MotionConfig, useReducedMotion } from "framer-motion";`,
  `import React from "react";`,
  `import * as React from "react";`,
  `import ReactLegacyContext from "react";\nclass FuzzLegacyContextProvider extends ReactLegacyContext.Component { static contextTypes = {}; render() { return null; } }`,
  `import { useState, useEffect, useMemo, useCallback, useRef, useContext, useReducer, useTransition, useDeferredValue, useId, useLayoutEffect, useSyncExternalStore } from "react";`,
  `import { useState as useLocalState } from "react";`,
  `import { createPortal } from "react-dom";`,
  `import Link from "next/link";`,
  `import Image from "next/image";`,
  `import dynamic from "next/dynamic";`,
  `import { View, Text, FlatList } from "react-native";`,
  `import { useQuery, useMutation } from "@tanstack/react-query";`,
  `import * as ReactQuery from "@tanstack/react-query";`,
  `import { observer } from "mobx-react-lite";`,
  `import { reaction, autorun } from "mobx";`,
  `import styled from "styled-components";`,
  `import { atom, useAtom } from "jotai";`,
  `import { useDispatch, useSelector } from "react-redux";`,
  `import { useNavigate, useSearchParams, useParams } from "react-router-dom";`,
  `import { useForm } from "react-hook-form";`,
  `import debounce from "lodash/debounce";`,
  `import { z } from "zod";`,
  `import * as fuzzZod from "zod/v4"; const fuzzZodSchema = fuzzZod.object({ email: fuzzZod.string().email() }).strict();`,
  `import { z as fuzzZodErrorCustomization } from "zod/v4"; const fuzzZodRequiredSchema = fuzzZodErrorCustomization.string("Required");`,
  `import { ZodError as FuzzZodError } from "zod/v4"; const fuzzZodFlattenedError = new FuzzZodError([]).flatten();`,
  `import { forwardRef } from "react";\nconst FuzzForwardRefComponent = forwardRef((props) => <button>{props.label}</button>);`,
  `import FuzzMarkdown from "react-markdown";\nimport fuzzRehypeRaw from "rehype-raw";`,
] as const;

// Filenames rotate per iteration because a large rule population is
// path-gated: test-noise skips, Next.js app/pages conventions, RN/e2e
// suffixes, client/server component markers. The plain src path dominates
// so most iterations still exercise full rule logic.
export const FUZZ_FILENAME_POOL = [
  "src/fuzz-fixture.tsx",
  "src/fuzz-fixture.tsx",
  "src/fuzz-fixture.tsx",
  "src/fuzz-fixture.tsx",
  "src/components/fuzz-widget.tsx",
  "src/hooks/use-fuzz-data.ts",
  "app/dashboard/page.tsx",
  "app/layout.tsx",
  "pages/index.tsx",
  "pages/api/items.ts",
  "src/fuzz-fixture.test.tsx",
  "src/fuzz-fixture.stories.tsx",
  "e2e/fuzz-flow.e2e.ts",
  "src/screens/fuzz-screen.tsx",
  "src/fuzz-widget.client.tsx",
  "src/fuzz-widget.server.tsx",
  "next.config.js",
  "src/utils/fuzz-helper.ts",
  "packages/docs/archive/v1/static/docs.js",
] as const;

// Identifiers rules key on by NAME (guard aliases, visibility gates,
// per-process constants, search terms). Woven into generated conditions so
// name-heuristic exemption paths get exercised, not just reporting paths.
export const TRIGGER_IDENTIFIER_POOL = [
  "canUseDOM",
  "isBrowser",
  "isMounted",
  "isOpen",
  "navOpen",
  "showTooltip",
  "isVisible",
  "searchTerm",
  "escapedQuery",
  "draftItems",
  "savingRef",
  "cancelled",
  "loading",
  "isComposing",
  "keyCode",
] as const;
