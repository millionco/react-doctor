// Canonical hook names shipped by the two popular utility-hook libraries
// `react-use` (streamich) and `usehooks-ts` (juliencrn). Source of truth
// for `prefer-existing-hook-library`, which flags top-level custom hooks
// whose names match this map so users can adopt the library version
// instead of hand-rolling one (hand-rolled versions commonly miss
// SSR safety, cleanup races, stale closures on identity-unstable
// callbacks, Strict-Mode double-fire, and cross-tab sync).
//
// Curation rules for this map:
//   - Only include names that are STRONGLY conventional. Everyone knows
//     what `useDebounce` does; the FP risk of a same-name custom hook
//     doing something completely different is low.
//   - EXCLUDE names that clash with framework/library hooks of the same
//     name (e.g. `useLocation` / `useNavigation` / `useSearchParams` from
//     react-router, `useEvent` / `useEventCallback` from React's own
//     experimental APIs, `useSpring` from react-spring). Detection is
//     name-only, so an ambiguous match is a false positive.
//   - List BOTH libraries when both ship the same name so the diagnostic
//     can recommend the one the user already has installed.

export interface HookLibraryAvailability {
  readonly reactUse: boolean;
  readonly usehooksTs: boolean;
}

// HACK: `useEvent` (react-use's plain event-subscribe hook) is intentionally
// OMITTED — React 19 also ships an experimental `useEvent` from `react`,
// and several router libraries reuse the name. Flagging on this name would
// false-positive on legitimate non-react-use code. Use the unambiguous
// `useEventListener` (usehooks-ts) entry instead.
//
// HACK: `useLocation`, `useNavigation`, `useSearchParams`, `useSearchParam`,
// `useHash`, `useRouter`, `useParams`, `usePathname` are omitted for the
// same reason: every routing library (react-router, Next, TanStack Router,
// remix, expo-router) ships hooks with these names.
//
// HACK: `useEventCallback` is omitted — both React-experimental and
// usehooks-ts use the name with different semantics. We don't want to
// recommend a swap on a hook that may be the React-native one.
//
// HACK: `useDarkMode` is omitted — the name is overloaded in the wild. The
// usehooks-ts version returns `{ isDarkMode, toggle, enable, disable, set }`,
// but most codebases that ship a `useDarkMode` hook use it as a void
// DOM-side-effect hook that applies theme classes (observed in tldraw,
// shadcn-style design systems, …). Same name, incompatible API → high FP
// rate. Users who do want the toggle version typically already import it
// directly from usehooks-ts.
export const HOOK_LIBRARY_MAP: ReadonlyMap<string, HookLibraryAvailability> =
  new Map([
    // Side-effects / timing
    ["useDebounce", { reactUse: true, usehooksTs: false }],
    ["useDebounceValue", { reactUse: false, usehooksTs: true }],
    ["useDebounceCallback", { reactUse: false, usehooksTs: true }],
    ["useThrottle", { reactUse: true, usehooksTs: false }],
    ["useThrottleFn", { reactUse: true, usehooksTs: false }],
    ["useInterval", { reactUse: true, usehooksTs: true }],
    ["useHarmonicIntervalFn", { reactUse: true, usehooksTs: false }],
    ["useTimeout", { reactUse: true, usehooksTs: true }],
    ["useTimeoutFn", { reactUse: true, usehooksTs: false }],
    ["useCountdown", { reactUse: false, usehooksTs: true }],

    // Storage
    ["useLocalStorage", { reactUse: true, usehooksTs: true }],
    ["useSessionStorage", { reactUse: true, usehooksTs: true }],
    ["useReadLocalStorage", { reactUse: false, usehooksTs: true }],
    // ["useCookie", { reactUse: true, usehooksTs: false }], // not needed (human decided)

    // Lifecycle helpers
    ["useMount", { reactUse: true, usehooksTs: false }],
    ["useUnmount", { reactUse: true, usehooksTs: true }],
    ["useUpdateEffect", { reactUse: true, usehooksTs: true }],
    ["useEffectOnce", { reactUse: true, usehooksTs: true }],
    ["useIsomorphicLayoutEffect", { reactUse: true, usehooksTs: true }],
    ["useDeepCompareEffect", { reactUse: true, usehooksTs: false }],
    ["useShallowCompareEffect", { reactUse: true, usehooksTs: false }],
    ["useCustomCompareEffect", { reactUse: true, usehooksTs: false }],
    ["useLifecycles", { reactUse: true, usehooksTs: false }],
    ["useLogger", { reactUse: true, usehooksTs: false }],

    // Mount / first-render trackers
    ["useIsMounted", { reactUse: false, usehooksTs: true }],
    ["useMountedState", { reactUse: true, usehooksTs: false }],
    ["useFirstMountState", { reactUse: true, usehooksTs: false }],
    ["useIsFirstRender", { reactUse: false, usehooksTs: true }],
    ["useIsClient", { reactUse: false, usehooksTs: true }],
    // ["useSsr", { reactUse: false, usehooksTs: true }], // not needed (human decided)

    // Previous / latest value
    ["usePrevious", { reactUse: true, usehooksTs: false }],
    ["usePreviousDistinct", { reactUse: true, usehooksTs: false }],
    ["useLatest", { reactUse: true, usehooksTs: false }],

    // Boolean / counter / step state
    ["useToggle", { reactUse: true, usehooksTs: true }],
    ["useBoolean", { reactUse: true, usehooksTs: true }],
    ["useCounter", { reactUse: true, usehooksTs: true }],
    ["useNumber", { reactUse: true, usehooksTs: false }],
    ["useStep", { reactUse: false, usehooksTs: true }],

    // Collection state
    ["useList", { reactUse: true, usehooksTs: false }],
    ["useMap", { reactUse: true, usehooksTs: true }],
    ["useSet", { reactUse: true, usehooksTs: false }],
    ["useQueue", { reactUse: true, usehooksTs: false }],
    ["useStateList", { reactUse: true, usehooksTs: false }],
    ["useStateWithHistory", { reactUse: true, usehooksTs: false }],

    // Setter-shaped state
    ["useSetState", { reactUse: true, usehooksTs: false }],
    ["useGetSet", { reactUse: true, usehooksTs: false }],
    ["useGetSetState", { reactUse: true, usehooksTs: false }],
    ["useDefault", { reactUse: true, usehooksTs: false }],
    ["useMediatedState", { reactUse: true, usehooksTs: false }],

    // Render / async
    ["useRendersCount", { reactUse: true, usehooksTs: false }],
    ["useUpdate", { reactUse: true, usehooksTs: false }],
    ["useAsync", { reactUse: true, usehooksTs: false }],
    ["useAsyncFn", { reactUse: true, usehooksTs: false }],
    ["useAsyncRetry", { reactUse: true, usehooksTs: false }],
    ["usePromise", { reactUse: true, usehooksTs: false }],
    ["useObservable", { reactUse: true, usehooksTs: false }],
    ["useMethods", { reactUse: true, usehooksTs: false }],

    // DOM observation
    ["useClickAway", { reactUse: true, usehooksTs: false }],
    ["useOnClickOutside", { reactUse: false, usehooksTs: true }],
    ["useClickAnyWhere", { reactUse: false, usehooksTs: true }],
    ["useEventListener", { reactUse: false, usehooksTs: true }],
    ["useHover", { reactUse: true, usehooksTs: true }],
    ["useHoverDirty", { reactUse: true, usehooksTs: false }],
    ["useIntersection", { reactUse: true, usehooksTs: false }],
    ["useIntersectionObserver", { reactUse: false, usehooksTs: true }],
    ["useResizeObserver", { reactUse: false, usehooksTs: true }],
    ["useMeasure", { reactUse: true, usehooksTs: false }],
    ["useSize", { reactUse: true, usehooksTs: false }],
    ["useLongPress", { reactUse: true, usehooksTs: false }],
    ["useScratch", { reactUse: true, usehooksTs: false }],
    ["useScroll", { reactUse: true, usehooksTs: false }],
    ["useScrolling", { reactUse: true, usehooksTs: false }],
    ["useWindowScroll", { reactUse: true, usehooksTs: false }],
    ["useWindowSize", { reactUse: true, usehooksTs: true }],
    ["usePageLeave", { reactUse: true, usehooksTs: false }],
    ["useScrollbarWidth", { reactUse: true, usehooksTs: false }],
    ["usePinchZoom", { reactUse: true, usehooksTs: false }],
    ["useScrollLock", { reactUse: false, usehooksTs: true }],
    ["useLockBodyScroll", { reactUse: true, usehooksTs: false }],
    ["useLockedBody", { reactUse: false, usehooksTs: true }],

    // Device / browser state
    ["useBattery", { reactUse: true, usehooksTs: false }],
    ["useGeolocation", { reactUse: true, usehooksTs: false }],
    ["useMedia", { reactUse: true, usehooksTs: false }],
    ["useMediaQuery", { reactUse: false, usehooksTs: true }],
    ["useMediaDevices", { reactUse: true, usehooksTs: false }],
    ["useNetworkState", { reactUse: true, usehooksTs: false }],
    ["useOrientation", { reactUse: true, usehooksTs: false }],
    ["useScreen", { reactUse: false, usehooksTs: true }],
    ["useMotion", { reactUse: true, usehooksTs: false }],
    ["useMouse", { reactUse: true, usehooksTs: false }],
    ["useMouseHovered", { reactUse: true, usehooksTs: false }],
    ["useMouseWheel", { reactUse: true, usehooksTs: false }],
    ["useIdle", { reactUse: true, usehooksTs: false }],
    ["usePermission", { reactUse: true, usehooksTs: false }],
    ["useStartTyping", { reactUse: true, usehooksTs: false }],
    ["useBeforeUnload", { reactUse: true, usehooksTs: false }],
    ["useKey", { reactUse: true, usehooksTs: false }],
    ["useKeyPress", { reactUse: true, usehooksTs: false }],
    ["useKeyPressEvent", { reactUse: true, usehooksTs: false }],
    ["useKeyboardJs", { reactUse: true, usehooksTs: false }],

    // Page / document chrome
    ["useTitle", { reactUse: true, usehooksTs: false }],
    ["useDocumentTitle", { reactUse: false, usehooksTs: true }],
    ["useFavicon", { reactUse: true, usehooksTs: false }],
    ["useTernaryDarkMode", { reactUse: false, usehooksTs: true }],

    // Clipboard / loading / scripts
    ["useCopyToClipboard", { reactUse: true, usehooksTs: true }],
    ["useScript", { reactUse: false, usehooksTs: true }],

    // Media UI
    ["useAudio", { reactUse: true, usehooksTs: false }],
    ["useVideo", { reactUse: true, usehooksTs: false }],
    ["useFullscreen", { reactUse: true, usehooksTs: false }],
    ["useSlider", { reactUse: true, usehooksTs: false }],
    ["useSpeech", { reactUse: true, usehooksTs: false }],
    ["useVibrate", { reactUse: true, usehooksTs: false }],

    // Animation / RAF
    ["useRaf", { reactUse: true, usehooksTs: false }],
    ["useRafLoop", { reactUse: true, usehooksTs: false }],
    ["useRafState", { reactUse: true, usehooksTs: false }],
    ["useTween", { reactUse: true, usehooksTs: false }],

    // Refs
    ["useEnsuredForwardedRef", { reactUse: true, usehooksTs: false }],

    // Drop-zones
    ["useDrop", { reactUse: true, usehooksTs: false }],
    ["useDropArea", { reactUse: true, usehooksTs: false }],

    // Misc errors
    ["useError", { reactUse: true, usehooksTs: false }],
  ]);
