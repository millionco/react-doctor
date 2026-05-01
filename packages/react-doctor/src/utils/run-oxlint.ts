import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ERROR_PREVIEW_LENGTH_CHARS,
  JSX_FILE_PATTERN,
  PROXY_OUTPUT_MAX_BYTES,
} from "../constants.js";
import { batchIncludePaths } from "./batch-include-paths.js";
import { collectIgnorePatterns } from "./collect-ignore-patterns.js";
import { ALL_REACT_DOCTOR_RULE_KEYS, createOxlintConfig } from "../oxlint-config.js";
import type { CleanedDiagnostic, Diagnostic, Framework, OxlintOutput } from "../types.js";
import { neutralizeDisableDirectives } from "./neutralize-disable-directives.js";

const esmRequire = createRequire(import.meta.url);

const PLUGIN_CATEGORY_MAP: Record<string, string> = {
  react: "Correctness",
  "react-hooks": "Correctness",
  "react-hooks-js": "React Compiler",
  "react-doctor": "Other",
  "jsx-a11y": "Accessibility",
  knip: "Dead Code",
};

const RULE_CATEGORY_MAP: Record<string, string> = {
  "react-doctor/no-derived-state-effect": "State & Effects",
  "react-doctor/no-fetch-in-effect": "State & Effects",
  "react-doctor/no-cascading-set-state": "State & Effects",
  "react-doctor/no-effect-event-handler": "State & Effects",
  "react-doctor/no-effect-event-in-deps": "State & Effects",
  "react-doctor/no-prop-callback-in-effect": "State & Effects",
  "react-doctor/no-derived-useState": "State & Effects",
  "react-doctor/prefer-useReducer": "State & Effects",
  "react-doctor/rerender-lazy-state-init": "Performance",
  "react-doctor/rerender-functional-setstate": "Performance",
  "react-doctor/rerender-dependencies": "State & Effects",
  "react-doctor/rerender-state-only-in-handlers": "Performance",
  "react-doctor/rerender-defer-reads-hook": "Performance",
  "react-doctor/advanced-event-handler-refs": "Performance",

  "react-doctor/no-generic-handler-names": "Architecture",
  "react-doctor/no-giant-component": "Architecture",
  "react-doctor/no-many-boolean-props": "Architecture",
  "react-doctor/no-react19-deprecated-apis": "Architecture",
  "react-doctor/no-render-prop-children": "Architecture",
  "react-doctor/no-render-in-render": "Architecture",
  "react-doctor/no-nested-component-definition": "Correctness",
  "react-doctor/react-compiler-destructure-method": "Architecture",

  "react-doctor/no-usememo-simple-expression": "Performance",
  "react-doctor/no-layout-property-animation": "Performance",
  "react-doctor/rerender-memo-with-default-value": "Performance",
  "react-doctor/rerender-memo-before-early-return": "Performance",
  "react-doctor/rerender-transitions-scroll": "Performance",
  "react-doctor/rerender-derived-state-from-hook": "Performance",
  "react-doctor/async-defer-await": "Performance",
  "react-doctor/async-await-in-loop": "Performance",
  "react-doctor/rendering-animate-svg-wrapper": "Performance",
  "react-doctor/rendering-hoist-jsx": "Performance",
  "react-doctor/rendering-hydration-mismatch-time": "Correctness",
  "react-doctor/rendering-usetransition-loading": "Performance",
  "react-doctor/rendering-hydration-no-flicker": "Performance",
  "react-doctor/rendering-script-defer-async": "Performance",
  "react-doctor/no-inline-prop-on-memo-component": "Performance",

  "react-doctor/no-transition-all": "Performance",
  "react-doctor/no-global-css-variable-animation": "Performance",
  "react-doctor/no-large-animated-blur": "Performance",
  "react-doctor/no-scale-from-zero": "Performance",
  "react-doctor/no-permanent-will-change": "Performance",

  "react-doctor/no-secrets-in-client-code": "Security",

  "react-doctor/no-barrel-import": "Bundle Size",
  "react-doctor/no-dynamic-import-path": "Bundle Size",
  "react-doctor/no-full-lodash-import": "Bundle Size",
  "react-doctor/no-moment": "Bundle Size",
  "react-doctor/prefer-dynamic-import": "Bundle Size",
  "react-doctor/use-lazy-motion": "Bundle Size",
  "react-doctor/no-undeferred-third-party": "Bundle Size",

  "react-doctor/no-array-index-as-key": "Correctness",
  "react-doctor/no-polymorphic-children": "Architecture",
  "react-doctor/rendering-conditional-render": "Correctness",
  "react-doctor/rendering-svg-precision": "Performance",
  "react-doctor/no-prevent-default": "Correctness",
  "react-doctor/no-document-start-view-transition": "Correctness",
  "react-doctor/no-flush-sync": "Performance",
  "react-doctor/nextjs-no-img-element": "Next.js",
  "react-doctor/nextjs-async-client-component": "Next.js",
  "react-doctor/nextjs-no-a-element": "Next.js",
  "react-doctor/nextjs-no-use-search-params-without-suspense": "Next.js",
  "react-doctor/nextjs-no-client-fetch-for-server-data": "Next.js",
  "react-doctor/nextjs-missing-metadata": "Next.js",
  "react-doctor/nextjs-no-client-side-redirect": "Next.js",
  "react-doctor/nextjs-no-redirect-in-try-catch": "Next.js",
  "react-doctor/nextjs-image-missing-sizes": "Next.js",
  "react-doctor/nextjs-no-native-script": "Next.js",
  "react-doctor/nextjs-inline-script-missing-id": "Next.js",
  "react-doctor/nextjs-no-font-link": "Next.js",
  "react-doctor/nextjs-no-css-link": "Next.js",
  "react-doctor/nextjs-no-polyfill-script": "Next.js",
  "react-doctor/nextjs-no-head-import": "Next.js",
  "react-doctor/nextjs-no-side-effect-in-get-handler": "Security",

  "react-doctor/server-auth-actions": "Server",
  "react-doctor/server-after-nonblocking": "Server",
  "react-doctor/server-no-mutable-module-state": "Server",
  "react-doctor/server-cache-with-object-literal": "Server",
  "react-doctor/server-hoist-static-io": "Server",
  "react-doctor/server-dedup-props": "Server",
  "react-doctor/server-sequential-independent-await": "Server",
  "react-doctor/server-fetch-without-revalidate": "Server",

  "react-doctor/client-passive-event-listeners": "Performance",
  "react-doctor/client-localstorage-no-version": "Correctness",

  "react-doctor/query-stable-query-client": "TanStack Query",
  "react-doctor/query-no-rest-destructuring": "TanStack Query",
  "react-doctor/query-no-void-query-fn": "TanStack Query",
  "react-doctor/query-no-query-in-effect": "TanStack Query",
  "react-doctor/query-mutation-missing-invalidation": "TanStack Query",
  "react-doctor/query-no-usequery-for-mutation": "TanStack Query",

  "react-doctor/no-inline-bounce-easing": "Performance",
  "react-doctor/no-z-index-9999": "Architecture",
  "react-doctor/no-inline-exhaustive-style": "Architecture",
  "react-doctor/no-side-tab-border": "Architecture",
  "react-doctor/no-pure-black-background": "Architecture",
  "react-doctor/no-gradient-text": "Architecture",
  "react-doctor/no-dark-mode-glow": "Architecture",
  "react-doctor/no-justified-text": "Accessibility",
  "react-doctor/no-tiny-text": "Accessibility",
  "react-doctor/no-wide-letter-spacing": "Architecture",
  "react-doctor/no-gray-on-colored-background": "Accessibility",
  "react-doctor/no-layout-transition-inline": "Performance",
  "react-doctor/no-disabled-zoom": "Accessibility",
  "react-doctor/no-outline-none": "Accessibility",
  "react-doctor/no-long-transition-duration": "Performance",

  "react-doctor/js-flatmap-filter": "Performance",
  "react-doctor/js-combine-iterations": "Performance",
  "react-doctor/js-tosorted-immutable": "Performance",
  "react-doctor/js-hoist-regexp": "Performance",
  "react-doctor/js-hoist-intl": "Performance",
  "react-doctor/js-cache-property-access": "Performance",
  "react-doctor/js-length-check-first": "Performance",
  "react-doctor/js-min-max-loop": "Performance",
  "react-doctor/js-set-map-lookups": "Performance",
  "react-doctor/js-batch-dom-css": "Performance",
  "react-doctor/js-index-maps": "Performance",
  "react-doctor/js-cache-storage": "Performance",
  "react-doctor/js-early-exit": "Performance",

  "react-doctor/no-eval": "Security",

  "react-doctor/async-parallel": "Performance",

  "react-doctor/rn-no-raw-text": "React Native",
  "react-doctor/rn-no-deprecated-modules": "React Native",
  "react-doctor/rn-no-legacy-expo-packages": "React Native",
  "react-doctor/rn-no-dimensions-get": "React Native",
  "react-doctor/rn-no-inline-flatlist-renderitem": "React Native",
  "react-doctor/rn-no-legacy-shadow-styles": "React Native",
  "react-doctor/rn-prefer-reanimated": "React Native",
  "react-doctor/rn-no-single-element-style-array": "React Native",
  "react-doctor/rn-prefer-pressable": "React Native",
  "react-doctor/rn-prefer-expo-image": "React Native",
  "react-doctor/rn-no-non-native-navigator": "React Native",
  "react-doctor/rn-no-scroll-state": "React Native",
  "react-doctor/rn-no-scrollview-mapped-list": "React Native",
  "react-doctor/rn-no-inline-object-in-list-item": "React Native",
  "react-doctor/rn-animate-layout-property": "React Native",
  "react-doctor/rn-prefer-content-inset-adjustment": "React Native",
  "react-doctor/rn-pressable-shared-value-mutation": "React Native",
  "react-doctor/rn-list-data-mapped": "React Native",
  "react-doctor/rn-list-callback-per-row": "React Native",
  "react-doctor/rn-list-recyclable-without-types": "React Native",
  "react-doctor/rn-animation-reaction-as-derived": "React Native",
  "react-doctor/rn-bottom-sheet-prefer-native": "React Native",
  "react-doctor/rn-scrollview-dynamic-padding": "React Native",
  "react-doctor/rn-style-prefer-boxshadow": "React Native",

  "react-doctor/tanstack-start-route-property-order": "TanStack Start",
  "react-doctor/tanstack-start-no-direct-fetch-in-loader": "TanStack Start",
  "react-doctor/tanstack-start-server-fn-validate-input": "TanStack Start",
  "react-doctor/tanstack-start-no-useeffect-fetch": "TanStack Start",
  "react-doctor/tanstack-start-missing-head-content": "TanStack Start",
  "react-doctor/tanstack-start-no-anchor-element": "TanStack Start",
  "react-doctor/tanstack-start-server-fn-method-order": "TanStack Start",
  "react-doctor/tanstack-start-no-navigate-in-render": "TanStack Start",
  "react-doctor/tanstack-start-no-dynamic-server-fn-import": "TanStack Start",
  "react-doctor/tanstack-start-no-use-server-in-handler": "TanStack Start",
  "react-doctor/tanstack-start-no-secrets-in-loader": "Security",
  "react-doctor/tanstack-start-get-mutation": "Security",
  "react-doctor/tanstack-start-redirect-in-try-catch": "TanStack Start",
  "react-doctor/tanstack-start-loader-parallel-fetch": "Performance",
};

const RULE_HELP_MAP: Record<string, string> = {
  "no-derived-state-effect":
    "For derived state, compute inline: `const x = fn(dep)`. For state resets on prop change, use a key prop: `<Component key={prop} />`. See https://react.dev/learn/you-might-not-need-an-effect",
  "no-fetch-in-effect":
    "Use `useQuery()` from @tanstack/react-query, `useSWR()`, or fetch in a Server Component instead",
  "no-cascading-set-state":
    "Combine into useReducer: `const [state, dispatch] = useReducer(reducer, initialState)`",
  "no-effect-event-handler":
    "Move the conditional logic into onClick, onChange, or onSubmit handlers directly",
  "no-derived-useState":
    "Remove useState and compute the value inline: `const value = transform(propName)`",
  "prefer-useReducer":
    "Group related state: `const [state, dispatch] = useReducer(reducer, { field1, field2, ... })`",
  "rerender-lazy-state-init":
    "Wrap in an arrow function so it only runs once: `useState(() => expensiveComputation())`",
  "rerender-functional-setstate":
    "Use the callback form: `setState(prev => prev + 1)` to always read the latest value",
  "rerender-dependencies":
    "Extract to a useMemo, useRef, or module-level constant so the reference is stable",
  "no-effect-event-in-deps":
    "Call the useEffectEvent callback inside the effect body without listing it; its identity is intentionally unstable",
  "no-prop-callback-in-effect":
    "Lift the shared state into a Provider so both sides read the same source — no useEffect-driven sync needed",

  "no-generic-handler-names":
    "Rename to describe the action: e.g. `handleSubmit` → `saveUserProfile`, `handleClick` → `toggleSidebar`",
  "no-giant-component":
    "Extract logical sections into focused components: `<UserHeader />`, `<UserActions />`, etc.",
  "no-many-boolean-props":
    "Split into compound components or named variants: `<Button.Primary />`, `<DialogConfirm />` instead of stacking `isPrimary`, `isConfirm` flags",
  "no-react19-deprecated-apis":
    "Pass `ref` as a regular prop on function components — `forwardRef` is no longer needed in React 19+. Replace `useContext(X)` with `use(X)` for branch-aware context reads.",
  "no-render-prop-children":
    "Replace `renderXxx` props with compound subcomponents (e.g. `<Modal.Header>`) or `children` so the parent doesn't dictate every customization point",
  "no-render-in-render":
    "Extract to a named component: `const ListItem = ({ item }) => <div>{item.name}</div>`",
  "no-nested-component-definition":
    "Move to a separate file or to module scope above the parent component",

  "no-usememo-simple-expression":
    "Remove useMemo — property access, math, and ternaries are already cheap without memoization",
  "no-layout-property-animation":
    "Use `transform: translateX()` or `scale()` instead — they run on the compositor and skip layout/paint",
  "rerender-memo-with-default-value":
    "Move to module scope: `const EMPTY_ITEMS: Item[] = []` then use as the default value",
  "rendering-animate-svg-wrapper":
    "Wrap the SVG: `<motion.div animate={...}><svg>...</svg></motion.div>`",
  "rendering-hoist-jsx":
    "Move the static JSX to module scope: `const ICON = <svg>...</svg>` outside the component so it isn't recreated each render",
  "rerender-memo-before-early-return":
    "Extract the JSX into a memoized child component so the parent's early return short-circuits before the child renders",
  "rerender-transitions-scroll":
    "Wrap the setState in startTransition (mark as non-urgent), use useDeferredValue, or stash in a ref + rAF throttle so scroll/pointer events don't trigger a re-render per fire",
  "rerender-state-only-in-handlers":
    "Replace useState with useRef when the value is only mutated and never read in render — `ref.current = ...` updates without re-rendering the component",
  "rerender-defer-reads-hook":
    "Read the URL state inside the handler (e.g. `new URL(window.location.href).searchParams`) so the component doesn't subscribe and re-render on every URL change",
  "rerender-derived-state-from-hook":
    'Use a threshold/media-query hook (e.g. `useMediaQuery("(max-width: 767px)")`) — the component re-renders only when the threshold flips, not every pixel',
  "advanced-event-handler-refs":
    "Store the handler in a ref and have the listener read `handlerRef.current()` — the subscription stays put while the latest handler is always called",
  "async-defer-await":
    "Move the `await` after the synchronous early-return guard so the skip path stays fast",
  "async-await-in-loop":
    "Collect the items and use `await Promise.all(items.map(...))` to run independent operations concurrently",
  "react-compiler-destructure-method":
    "Destructure the method up front: `const { push } = useRouter()` then call `push(...)` directly — clearer dependency graph and easier for React Compiler to memoize",
  "client-localstorage-no-version":
    'Bake a version into the storage key (e.g. "myKey:v1"); a future schema change can ignore old data instead of crashing on it',
  "server-sequential-independent-await":
    "Wrap independent awaits in `Promise.all([...])` so they race instead of waterfalling — second call doesn't depend on the first",
  "server-fetch-without-revalidate":
    'Pass `{ next: { revalidate: <seconds> } }` (or `cache: "no-store"` / `next: { tags: [...] }`) so stale cached data doesn\'t silently persist',
  "rn-list-callback-per-row":
    "Hoist the handler with useCallback at list scope and pass the row id as a primitive prop, so the row's memo() shallow-compare actually hits",
  "rn-list-recyclable-without-types":
    "Add `getItemType={item => item.kind}` so FlashList keeps separate recycle pools per item type — heterogeneous rows shouldn't share recycled cells",
  "rn-style-prefer-boxshadow":
    'Use the cross-platform CSS `boxShadow` string (RN v7+): `boxShadow: "0 2px 8px rgba(0,0,0,0.1)"` instead of platform-specific shadow*/elevation keys',
  "rendering-hydration-mismatch-time":
    "Wrap dynamic time/random values in useEffect+useState (client-only) or add suppressHydrationWarning to the parent if intentional",
  "no-polymorphic-children":
    "Expose explicit subcomponents (`<Button.Text>`, `<Button.Icon>`) so consumers don't need to switch on `typeof children`",
  "rendering-svg-precision":
    "Truncate path/points/transform decimals to 1–2 digits — sub-pixel precision adds bytes with no visible difference",
  "no-document-start-view-transition":
    "Render a <ViewTransition> component and update inside startTransition / useDeferredValue — React calls startViewTransition for you",
  "no-flush-sync":
    "Use startTransition for non-urgent updates — flushSync forces a sync flush that skips View Transitions and concurrent rendering",
  "rendering-usetransition-loading":
    "Replace with `const [isPending, startTransition] = useTransition()` — avoids a re-render for the loading state",
  "rendering-hydration-no-flicker":
    "Use `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)` or add `suppressHydrationWarning` to the element",
  "rendering-script-defer-async":
    'Add `defer` for DOM-dependent scripts or `async` for independent ones (analytics). In Next.js, use `<Script strategy="afterInteractive" />` instead',
  "no-inline-prop-on-memo-component":
    "Hoist the inline `() => ...` / `[]` / `{}` to a stable reference (useMemo, useCallback, or module scope) so the memoized child doesn't re-render every parent render",

  "no-transition-all":
    'List specific properties: `transition: "opacity 200ms, transform 200ms"` — or in Tailwind use `transition-colors`, `transition-opacity`, or `transition-transform`',
  "no-global-css-variable-animation":
    "Set the variable on the nearest element instead of a parent, or use `@property` with `inherits: false` to prevent cascade. Better yet, use targeted `element.style.transform` updates",
  "no-large-animated-blur":
    "Keep blur radius under 10px, or apply blur to a smaller element. Large blurs multiply GPU memory usage with layer size",
  "no-scale-from-zero":
    "Use `initial={{ scale: 0.95, opacity: 0 }}` — elements should deflate like a balloon, not vanish into a point",
  "no-permanent-will-change":
    "Add will-change on animation start (`onMouseEnter`) and remove on end (`onAnimationEnd`). Permanent promotion wastes GPU memory and can degrade performance",

  "no-secrets-in-client-code":
    "Move to server-side `process.env.SECRET_NAME`. Only `NEXT_PUBLIC_*` vars are safe for the client (and should not contain secrets)",

  "no-barrel-import":
    "Import from the direct path: `import { Button } from './components/Button'` instead of `./components`",
  "no-dynamic-import-path":
    "Use a string-literal path: `import('./feature/heavy.js')` so the bundler can split this chunk",
  "no-full-lodash-import":
    "Import the specific function: `import debounce from 'lodash/debounce'` — saves ~70kb",
  "no-moment":
    "Replace with `import { format } from 'date-fns'` (tree-shakeable) or `import dayjs from 'dayjs'` (2kb)",
  "prefer-dynamic-import":
    "Use `const Component = dynamic(() => import('library'), { ssr: false })` from next/dynamic or React.lazy()",
  "use-lazy-motion":
    'Use `import { LazyMotion, m } from "framer-motion"` with `domAnimation` features — saves ~30kb',
  "no-undeferred-third-party":
    'Use `next/script` with `strategy="lazyOnload"` or add the `defer` attribute',

  "no-inline-bounce-easing":
    "Use `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-expo) for natural deceleration — objects in the real world don't bounce",
  "no-z-index-9999":
    "Define a z-index scale in your design tokens (e.g. dropdown: 10, modal: 20, toast: 30). Create a new stacking context with `isolation: isolate` instead of escalating values",
  "no-inline-exhaustive-style":
    "Move styles to a CSS class, CSS module, Tailwind utilities, or a styled component — inline objects with many properties hurt readability and create new references every render",
  "no-side-tab-border":
    "Use a subtler accent (box-shadow inset, background gradient, or border-bottom) instead of a thick one-sided border",
  "no-pure-black-background":
    "Tint the background slightly toward your brand hue — e.g. `#0a0a0f` or Tailwind's `bg-gray-950`. Pure black looks harsh on modern displays",
  "no-gradient-text":
    "Use solid text colors for readability. If you need emphasis, use font weight, size, or a distinct color instead of gradients",
  "no-dark-mode-glow":
    "Use a subtle `box-shadow` with neutral colors for depth, or `border` with low opacity. Colored glows on dark backgrounds are the default AI-generated aesthetic",
  "no-justified-text":
    "Use `text-align: left` for body text, or add `hyphens: auto` and `overflow-wrap: break-word` if you must justify",
  "no-tiny-text":
    "Use at least 12px for body content, 16px is ideal. Small text is hard to read, especially on high-DPI mobile screens",
  "no-wide-letter-spacing":
    "Reserve wide tracking (letter-spacing > 0.05em) for short uppercase labels, navigation items, and buttons — not body text",
  "no-gray-on-colored-background":
    "Use a darker shade of the background color for text, or white/near-white for contrast. Gray text on colored backgrounds looks washed out",
  "no-layout-transition-inline":
    "Use `transform` and `opacity` for transitions — they run on the compositor thread. For height animations, use `grid-template-rows: 0fr → 1fr`",
  "no-disabled-zoom":
    "Remove `user-scalable=no` and `maximum-scale` from the viewport meta tag. If your layout breaks at 200% zoom, fix the layout — don't punish users with disabilities",
  "no-outline-none":
    "Use `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px }` to show focus only for keyboard users while hiding it for mouse clicks",
  "no-long-transition-duration":
    "Keep UI transitions under 1s — 100-150ms for instant feedback, 200-300ms for state changes, 300-500ms for layout changes. Use longer durations only for page-load hero animations",

  "no-array-index-as-key":
    "Use a stable unique identifier: `key={item.id}` or `key={item.slug}` — index keys break on reorder/filter",
  "rendering-conditional-render":
    "Change to `{items.length > 0 && <List />}` or use a ternary: `{items.length ? <List /> : null}`",
  "no-prevent-default":
    "Use `<form action={serverAction}>` (works without JS) or `<button>` instead of `<a>` with preventDefault",

  "nextjs-no-img-element":
    "`import Image from 'next/image'` — provides automatic WebP/AVIF, lazy loading, and responsive srcset",
  "nextjs-async-client-component":
    "Fetch data in a parent Server Component and pass it as props, or use useQuery/useSWR in the client component",
  "nextjs-no-a-element":
    "`import Link from 'next/link'` — enables client-side navigation, prefetching, and preserves scroll position",
  "nextjs-no-use-search-params-without-suspense":
    "Wrap the component using useSearchParams: `<Suspense fallback={<Skeleton />}><SearchComponent /></Suspense>`",
  "nextjs-no-client-fetch-for-server-data":
    "Remove 'use client' and fetch directly in the Server Component — no API round-trip, secrets stay on server",
  "nextjs-missing-metadata":
    "Add `export const metadata = { title: '...', description: '...' }` or `export async function generateMetadata()`",
  "nextjs-no-client-side-redirect":
    "Avoid redirects inside useEffect. Use an event handler, middleware, or server-side redirect (App Router: redirect() from next/navigation; Pages Router: getServerSideProps redirect)",
  "nextjs-no-redirect-in-try-catch":
    "Move the redirect/notFound call outside the try block, or add `unstable_rethrow(error)` in the catch",
  "nextjs-image-missing-sizes":
    'Add sizes for responsive behavior: `sizes="(max-width: 768px) 100vw, 50vw"` matching your layout breakpoints',
  "nextjs-no-native-script":
    '`import Script from "next/script"` — use `strategy="afterInteractive"` for analytics or `"lazyOnload"` for widgets',
  "nextjs-inline-script-missing-id":
    'Add `id="descriptive-name"` so Next.js can track, deduplicate, and re-execute the script correctly',
  "nextjs-no-font-link":
    '`import { Inter } from "next/font/google"` — self-hosted, zero layout shift, no render-blocking requests',
  "nextjs-no-css-link":
    "Import CSS directly: `import './styles.css'` or use CSS Modules: `import styles from './Button.module.css'`",
  "nextjs-no-polyfill-script":
    "Next.js includes polyfills for fetch, Promise, Object.assign, Array.from, and 50+ others automatically",
  "nextjs-no-head-import":
    "Use the Metadata API instead: `export const metadata = { title: '...' }` or `export async function generateMetadata()`",
  "nextjs-no-side-effect-in-get-handler":
    "Move the side effect to a POST handler and use a <form> or fetch with method POST — GET requests can be triggered by prefetching and are vulnerable to CSRF",

  "server-auth-actions":
    "Add `const session = await auth()` at the top and throw/redirect if unauthorized before any data access",
  "server-after-nonblocking":
    "`import { after } from 'next/server'` then wrap: `after(() => analytics.track(...))` — response isn't blocked",
  "server-no-mutable-module-state":
    "Move per-request data into the action body, headers/cookies, or a request-scope (React.cache, AsyncLocalStorage). Module-scope `let`/`var` is shared across requests.",
  "server-cache-with-object-literal":
    "Pass primitives to React.cache()-wrapped functions — argument identity (not deep equality) is the dedup key, so a fresh `{}` per render bypasses the cache",
  "server-hoist-static-io":
    "Hoist the read to module scope: `const FONT_DATA = await fetch(new URL('./fonts/Inter.ttf', import.meta.url)).then(r => r.arrayBuffer())` runs once at module load",
  "server-dedup-props":
    "Pass the source array once and derive the projection on the client — passing both doubles RSC serialization bytes",

  "client-passive-event-listeners":
    "Add `{ passive: true }` as the third argument: `addEventListener('scroll', handler, { passive: true })`. Only do this if the handler does NOT call `event.preventDefault()` — passive listeners silently ignore `preventDefault()`, which breaks features like pull-to-refresh suppression, custom gestures, and nested-scroll containment.",

  "query-stable-query-client":
    "Move `new QueryClient()` to module scope or wrap in `useState(() => new QueryClient())` — recreating it on every render resets the entire cache",
  "query-no-rest-destructuring":
    "Destructure only the fields you need: `const { data, isLoading } = useQuery(...)` — rest destructuring subscribes to all fields and causes extra re-renders",
  "query-no-void-query-fn":
    "queryFn must return a value for the cache. Use the `enabled` option to conditionally disable the query instead of returning undefined",
  "query-no-query-in-effect":
    "React Query manages refetching automatically via queryKey dependencies and the `enabled` option — manual refetch() in useEffect is usually unnecessary",
  "query-mutation-missing-invalidation":
    "Add `onSuccess: () => queryClient.invalidateQueries({ queryKey: ['...'] })` so cached data stays in sync after the mutation",
  "query-no-usequery-for-mutation":
    "Use `useMutation()` for POST/PUT/DELETE — it provides onSuccess/onError callbacks, doesn't auto-refetch, and correctly models write operations",

  "js-flatmap-filter":
    "Use `.flatMap(item => condition ? [value] : [])` — transforms and filters in a single pass instead of creating an intermediate array",
  "js-hoist-intl":
    "Hoist `new Intl.NumberFormat(...)` to module scope or wrap in `useMemo` — Intl constructors allocate dozens of objects per locale lookup",
  "js-cache-property-access":
    "Hoist the deep member access into a const at the top of the loop body: `const { x, y } = obj.deeply.nested`",
  "js-length-check-first":
    "Short-circuit with `a.length === b.length && a.every((x, i) => x === b[i])` — unequal-length arrays exit immediately",
  "js-combine-iterations":
    "Combine `.map().filter()` (or similar chains) into a single pass with `.reduce()` or a `for...of` loop to avoid iterating the array twice",
  "js-tosorted-immutable":
    "Use `array.toSorted()` (ES2023) instead of `[...array].sort()` for immutable sorting without the spread allocation",
  "js-hoist-regexp":
    "Hoist `new RegExp(...)` (or large regex literals) to a module-level constant so it isn't recompiled on every loop iteration",
  "js-min-max-loop":
    "Use `Math.min(...array)` / `Math.max(...array)` instead of sorting just to read the first or last element",
  "js-set-map-lookups":
    "Use a `Set` or `Map` for repeated membership tests / keyed lookups — `Array.includes`/`find` is O(n) per call",
  "js-batch-dom-css":
    "Batch DOM/CSS reads and writes — interleaving them inside a loop causes layout thrashing. Read first, then write",
  "js-index-maps":
    "Build an index `Map` once outside the loop instead of `array.find(...)` inside it",
  "js-cache-storage":
    "Cache repeated `localStorage`/`sessionStorage` reads in a local variable — each access serializes/deserializes",
  "js-early-exit":
    "Add an early `return` / `continue` to flatten deep nesting and short-circuit when the predicate is already known",

  "no-eval":
    "Use `JSON.parse` for serialized data, `Function(...)` (still careful) for trusted templates, or refactor to avoid dynamic code execution",

  "async-parallel":
    "Use `const [a, b] = await Promise.all([fetchA(), fetchB()])` to run independent operations concurrently",

  "rn-no-raw-text":
    "Wrap text in a `<Text>` component: `<Text>{value}</Text>` — raw strings outside `<Text>` crash on React Native",
  "rn-no-deprecated-modules":
    "Import from the community package instead — deprecated modules were removed from the react-native core",
  "rn-no-legacy-expo-packages":
    "Migrate to the recommended replacement package — legacy Expo packages are no longer maintained",
  "rn-no-dimensions-get":
    "Use `const { width, height } = useWindowDimensions()` — it updates reactively on rotation and resize",
  "rn-no-inline-flatlist-renderitem":
    "Extract renderItem to a named function or wrap in useCallback to avoid re-creating on every render",
  "rn-no-legacy-shadow-styles":
    "Use `boxShadow` for cross-platform shadows on the new architecture instead of platform-specific shadow properties",
  "rn-prefer-reanimated":
    "Use `import Animated from 'react-native-reanimated'` — animations run on the UI thread instead of the JS thread",
  "rn-no-single-element-style-array":
    "Use `style={value}` instead of `style={[value]}` — single-element arrays add unnecessary allocation",
  "rn-prefer-pressable":
    "Use `<Pressable>` from react-native (or react-native-gesture-handler) instead of legacy Touchable* components",
  "rn-prefer-expo-image":
    "Use `<Image>` from `expo-image` instead of `react-native` — same prop API, plus disk + memory caching, placeholders, and crossfades",
  "rn-no-non-native-navigator":
    "Use `@react-navigation/native-stack` (or `native-tabs` in v7+) for platform-native transitions and gestures",
  "rn-no-scroll-state":
    "Track scroll position with a Reanimated shared value (`useAnimatedScrollHandler`) or a ref — `setState` on every scroll event causes re-render storms",
  "rn-no-scrollview-mapped-list":
    "Use FlashList, LegendList, or FlatList — `<ScrollView>{items.map(...)}</ScrollView>` mounts every row in memory",
  "rn-no-inline-object-in-list-item":
    "Hoist style/object props outside renderItem (StyleSheet.create, useMemo at list scope, or pass primitives) so memo() row components stop bailing",
  "rn-animate-layout-property":
    "Animate `transform: [{ translateX/Y }, { scale }]` and `opacity` instead of layout props — layout runs on the JS thread; transform/opacity run on the GPU compositor",
  "rn-prefer-content-inset-adjustment":
    'Drop the SafeAreaView wrapper and set `contentInsetAdjustmentBehavior="automatic"` on the ScrollView for native safe-area handling',
  "rn-pressable-shared-value-mutation":
    "Wrap in <GestureDetector gesture={Gesture.Tap()...}> so the press animation runs on the UI thread instead of bouncing across the JS bridge",
  "rn-list-data-mapped":
    "Wrap the projection in `useMemo(() => items.map(...), [items])` so the list's `data` prop has a stable reference across parent renders",
  "rn-animation-reaction-as-derived":
    "Replace useAnimatedReaction with `useDerivedValue(() => ..., [deps])` — shorter, native dependency tracking, no side-effect implication",
  "rn-bottom-sheet-prefer-native":
    'Use `<Modal presentationStyle="formSheet">` (RN v7+) for native gesture handling and snap points',
  "rn-scrollview-dynamic-padding":
    "Use `contentInset={{ bottom: dynamicValue }}` — the OS applies it as an offset without reflowing the scroll content",

  "tanstack-start-route-property-order":
    "Follow the order: params/validateSearch → loaderDeps → context → beforeLoad → loader → head. See https://tanstack.com/router/latest/docs/eslint/create-route-property-order",
  "tanstack-start-no-direct-fetch-in-loader":
    "Use `createServerFn()` from @tanstack/react-start — provides type-safe RPC, input validation, and proper server/client code splitting",
  "tanstack-start-server-fn-validate-input":
    "Add `.inputValidator(schema)` before `.handler()` — data crosses a network boundary and must be validated at runtime",
  "tanstack-start-no-useeffect-fetch":
    "Fetch data in the route `loader` instead — the router coordinates loading before rendering to avoid waterfalls",
  "tanstack-start-missing-head-content":
    "Add `<HeadContent />` inside `<head>` in your __root route — without it, route `head()` meta tags are silently dropped",
  "tanstack-start-no-anchor-element":
    "`import { Link } from '@tanstack/react-router'` — enables type-safe routes, preloading via `preload=\"intent\"`, and client-side navigation",
  "tanstack-start-server-fn-method-order":
    "Chain methods in order: .middleware() → .inputValidator() → .client() → .server() → .handler() — types depend on this sequence",
  "tanstack-start-no-navigate-in-render":
    "Use `throw redirect({ to: '/path' })` in `beforeLoad` or `loader` instead — navigate() during render causes hydration issues",
  "tanstack-start-no-dynamic-server-fn-import":
    "Use `import { myFn } from '~/utils/my.functions'` — the bundler replaces server code with RPC stubs only for static imports",
  "tanstack-start-no-use-server-in-handler":
    'TanStack Start handles server boundaries automatically via the Vite plugin — "use server" inside createServerFn causes compilation errors',
  "tanstack-start-no-secrets-in-loader":
    "Loaders are isomorphic (run on both server and client). Wrap secret access in `createServerFn()` so it stays server-only",
  "tanstack-start-get-mutation":
    "Use `createServerFn({ method: 'POST' })` for data modifications — GET requests can be triggered by prefetching and are vulnerable to CSRF",
  "tanstack-start-redirect-in-try-catch":
    "TanStack Router's `redirect()` and `notFound()` throw special errors caught by the router. Move them outside the try block or re-throw in the catch",
  "tanstack-start-loader-parallel-fetch":
    "Use `const [a, b] = await Promise.all([fetchA(), fetchB()])` to avoid request waterfalls in route loaders",
};

const FILEPATH_WITH_LOCATION_PATTERN = /\S+\.\w+:\d+:\d+[\s\S]*$/;

const REACT_COMPILER_MESSAGE = "React Compiler can't optimize this code";

const cleanDiagnosticMessage = (
  message: string,
  help: string,
  plugin: string,
  rule: string,
): CleanedDiagnostic => {
  if (plugin === "react-hooks-js") {
    const rawMessage = message.replace(FILEPATH_WITH_LOCATION_PATTERN, "").trim();
    return { message: REACT_COMPILER_MESSAGE, help: rawMessage || help };
  }
  const cleaned = message.replace(FILEPATH_WITH_LOCATION_PATTERN, "").trim();
  return { message: cleaned || message, help: help || RULE_HELP_MAP[rule] || "" };
};

const parseRuleCode = (code: string): { plugin: string; rule: string } => {
  const match = code.match(/^(.+)\((.+)\)$/);
  if (!match) return { plugin: "unknown", rule: code };
  return { plugin: match[1].replace(/^eslint-plugin-/, ""), rule: match[2] };
};

const resolveOxlintBinary = (): string => {
  const oxlintMainPath = esmRequire.resolve("oxlint");
  const oxlintPackageDirectory = path.resolve(path.dirname(oxlintMainPath), "..");
  return path.join(oxlintPackageDirectory, "bin", "oxlint");
};

const resolvePluginPath = (): string => {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const pluginPath = path.join(currentDirectory, "react-doctor-plugin.js");
  if (fs.existsSync(pluginPath)) return pluginPath;

  const distPluginPath = path.resolve(currentDirectory, "../../dist/react-doctor-plugin.js");
  if (fs.existsSync(distPluginPath)) return distPluginPath;

  return pluginPath;
};

const resolveDiagnosticCategory = (plugin: string, rule: string): string => {
  const ruleKey = `${plugin}/${rule}`;
  return RULE_CATEGORY_MAP[ruleKey] ?? PLUGIN_CATEGORY_MAP[plugin] ?? "Other";
};

// HACK: Sanitize child env so a developer's NODE_OPTIONS=--inspect (or
// --max-old-space-size=128, etc.) doesn't leak into oxlint and either spawn a
// debugger port or starve it of memory. We also drop npm_config_* lifecycle
// vars to keep oxlint from picking up package-manager state. PATH, HOME,
// NODE_ENV, NODE_PATH, etc. pass through unchanged.
const SANITIZED_ENV: NodeJS.ProcessEnv = (() => {
  const sanitized: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (name === "NODE_OPTIONS" || name === "NODE_DEBUG") continue;
    if (name.startsWith("npm_config_")) continue;
    sanitized[name] = value;
  }
  return sanitized;
})();

const OXLINT_SPAWN_TIMEOUT_MS = 5 * 60_000;

const spawnOxlint = (
  args: string[],
  rootDirectory: string,
  nodeBinaryPath: string,
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(nodeBinaryPath, args, {
      cwd: rootDirectory,
      env: SANITIZED_ENV,
    });

    const timeoutHandle = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `oxlint did not return within ${OXLINT_SPAWN_TIMEOUT_MS / 1000}s — please report`,
        ),
      );
    }, OXLINT_SPAWN_TIMEOUT_MS);
    timeoutHandle.unref?.();

    const stdoutBuffers: Buffer[] = [];
    const stderrBuffers: Buffer[] = [];
    let stdoutByteCount = 0;
    let stderrByteCount = 0;
    let didKillForSize = false;

    const killIfTooLarge = (incomingBytes: number, isStdout: boolean): boolean => {
      if (isStdout) {
        stdoutByteCount += incomingBytes;
      } else {
        stderrByteCount += incomingBytes;
      }
      if (stdoutByteCount + stderrByteCount > PROXY_OUTPUT_MAX_BYTES && !didKillForSize) {
        didKillForSize = true;
        child.kill("SIGKILL");
        return true;
      }
      return false;
    };

    child.stdout.on("data", (buffer: Buffer) => {
      if (didKillForSize) return;
      stdoutBuffers.push(buffer);
      killIfTooLarge(buffer.length, true);
    });
    child.stderr.on("data", (buffer: Buffer) => {
      if (didKillForSize) return;
      stderrBuffers.push(buffer);
      killIfTooLarge(buffer.length, false);
    });

    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      reject(new Error(`Failed to run oxlint: ${error.message}`));
    });
    child.on("close", (_code, signal) => {
      clearTimeout(timeoutHandle);
      if (didKillForSize) {
        reject(
          new Error(
            `oxlint output exceeded ${PROXY_OUTPUT_MAX_BYTES} bytes — scan a smaller subset with --diff or --staged`,
          ),
        );
        return;
      }
      if (signal) {
        const stderrOutput = Buffer.concat(stderrBuffers).toString("utf-8").trim();
        const hint =
          signal === "SIGABRT" ? " (out of memory — try scanning fewer files with --diff)" : "";
        const detail = stderrOutput ? `: ${stderrOutput}` : "";
        reject(new Error(`oxlint was killed by ${signal}${hint}${detail}`));
        return;
      }
      const output = Buffer.concat(stdoutBuffers).toString("utf-8").trim();
      if (!output) {
        const stderrOutput = Buffer.concat(stderrBuffers).toString("utf-8").trim();
        if (stderrOutput) {
          reject(new Error(`Failed to run oxlint: ${stderrOutput}`));
          return;
        }
      }
      resolve(output);
    });
  });

const isOxlintOutput = (value: unknown): value is OxlintOutput => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { diagnostics?: unknown };
  return Array.isArray(candidate.diagnostics);
};

const parseOxlintOutput = (stdout: string): Diagnostic[] => {
  if (!stdout) return [];

  // HACK: oxlint sometimes prepends a notice line to stdout (e.g. when
  // every input was ignored — "No files found to lint. Please check…").
  // Skip any leading non-JSON noise by jumping to the first `{` we see;
  // the remainder is the actual report. Locale- and wording-agnostic.
  const jsonStart = stdout.indexOf("{");
  const sanitizedStdout = jsonStart > 0 ? stdout.slice(jsonStart) : stdout;

  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitizedStdout);
  } catch {
    throw new Error(
      `Failed to parse oxlint output: ${stdout.slice(0, ERROR_PREVIEW_LENGTH_CHARS)}`,
    );
  }

  if (!isOxlintOutput(parsed)) {
    throw new Error(
      `Unexpected oxlint output shape: ${stdout.slice(0, ERROR_PREVIEW_LENGTH_CHARS)}`,
    );
  }
  const output = parsed;

  return output.diagnostics
    .filter((diagnostic) => diagnostic.code && JSX_FILE_PATTERN.test(diagnostic.filename))
    .map((diagnostic) => {
      const { plugin, rule } = parseRuleCode(diagnostic.code);
      const primaryLabel = diagnostic.labels[0];

      const cleaned = cleanDiagnosticMessage(diagnostic.message, diagnostic.help, plugin, rule);

      return {
        filePath: diagnostic.filename,
        plugin,
        rule,
        severity: diagnostic.severity,
        message: cleaned.message,
        help: cleaned.help,
        line: primaryLabel?.span.line ?? 0,
        column: primaryLabel?.span.column ?? 0,
        category: resolveDiagnosticCategory(plugin, rule),
      };
    });
};

const TSCONFIG_FILENAMES = ["tsconfig.json", "tsconfig.base.json"];

const resolveTsConfigRelativePath = (rootDirectory: string): string | null => {
  for (const filename of TSCONFIG_FILENAMES) {
    if (fs.existsSync(path.join(rootDirectory, filename))) {
      return `./${filename}`;
    }
  }
  return null;
};

interface RunOxlintOptions {
  rootDirectory: string;
  hasTypeScript: boolean;
  framework: Framework;
  hasReactCompiler: boolean;
  hasTanStackQuery: boolean;
  includePaths?: string[];
  nodeBinaryPath?: string;
  customRulesOnly?: boolean;
  /**
   * When `true` (default), pre-existing `// eslint-disable*` / `// oxlint-disable*`
   * comments in source files are LEFT ALONE — oxlint will apply them
   * normally, suppressing react-doctor diagnostics on those lines.
   * When `false`, those comment markers are temporarily neutralized
   * so react-doctor sees through every prior suppression (audit mode).
   */
  respectInlineDisables?: boolean;
}

let didValidateRuleRegistration = false;

const validateRuleRegistration = (): void => {
  if (didValidateRuleRegistration) return;
  didValidateRuleRegistration = true;
  const missingHelp: string[] = [];
  const missingCategory: string[] = [];
  for (const fullKey of ALL_REACT_DOCTOR_RULE_KEYS) {
    const ruleName = fullKey.replace(/^react-doctor\//, "");
    if (!(fullKey in RULE_CATEGORY_MAP)) {
      missingCategory.push(fullKey);
    }
    if (!(ruleName in RULE_HELP_MAP)) {
      missingHelp.push(fullKey);
    }
  }
  if (missingCategory.length > 0 || missingHelp.length > 0) {
    const detail = [
      missingCategory.length > 0
        ? `Missing RULE_CATEGORY_MAP entries: ${missingCategory.join(", ")}`
        : null,
      missingHelp.length > 0 ? `Missing RULE_HELP_MAP entries: ${missingHelp.join(", ")}` : null,
    ]
      .filter((entry): entry is string => entry !== null)
      .join("; ");
    // HACK: warn rather than throw — never block the user's scan over a metadata gap.
    console.warn(`[react-doctor] rule-registration drift: ${detail}`);
  }
};

export const runOxlint = async (options: RunOxlintOptions): Promise<Diagnostic[]> => {
  const {
    rootDirectory,
    hasTypeScript,
    framework,
    hasReactCompiler,
    hasTanStackQuery,
    includePaths,
    nodeBinaryPath = process.execPath,
    customRulesOnly = false,
    respectInlineDisables = true,
  } = options;

  validateRuleRegistration();

  if (includePaths !== undefined && includePaths.length === 0) {
    return [];
  }

  const configDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-oxlintrc-"));
  const configPath = path.join(configDirectory, "oxlintrc.json");
  const pluginPath = resolvePluginPath();
  const config = createOxlintConfig({
    pluginPath,
    framework,
    hasReactCompiler,
    hasTanStackQuery,
    customRulesOnly,
  });
  // HACK: only neutralize disable comments in audit mode. Default
  // behavior respects the user's existing `// eslint-disable*` /
  // `// oxlint-disable*` directives — we let oxlint apply them.
  const restoreDisableDirectives = respectInlineDisables
    ? () => {}
    : neutralizeDisableDirectives(rootDirectory, includePaths);

  try {
    const fileHandle = fs.openSync(configPath, "wx", 0o600);
    try {
      fs.writeFileSync(fileHandle, JSON.stringify(config));
    } finally {
      fs.closeSync(fileHandle);
    }

    const oxlintBinary = resolveOxlintBinary();
    const baseArgs = [oxlintBinary, "-c", configPath, "--format", "json"];

    if (hasTypeScript) {
      const tsconfigRelativePath = resolveTsConfigRelativePath(rootDirectory);
      if (tsconfigRelativePath) {
        baseArgs.push("--tsconfig", tsconfigRelativePath);
      }
    }

    // HACK: pass every ignore source via a single combined `--ignore-path`
    // file (cheap on `baseArgs` length) rather than N `--ignore-pattern`
    // entries (which would inflate per-batch arg length and shrink the
    // file-count budget on large diffs). The combined file MUST include
    // `.eslintignore` patterns because `--ignore-path` overrides oxlint's
    // automatic `.eslintignore` lookup — that responsibility now lives
    // in `collectIgnorePatterns`.
    const combinedPatterns = collectIgnorePatterns(rootDirectory);
    if (combinedPatterns.length > 0) {
      const combinedIgnorePath = path.join(configDirectory, "combined.ignore");
      fs.writeFileSync(combinedIgnorePath, `${combinedPatterns.join("\n")}\n`);
      baseArgs.push("--ignore-path", combinedIgnorePath);
    }

    const fileBatches =
      includePaths !== undefined ? batchIncludePaths(baseArgs, includePaths) : [["."]];

    const allDiagnostics: Diagnostic[] = [];
    for (const batch of fileBatches) {
      const batchArgs = [...baseArgs, ...batch];
      const stdout = await spawnOxlint(batchArgs, rootDirectory, nodeBinaryPath);
      allDiagnostics.push(...parseOxlintOutput(stdout));
    }

    return allDiagnostics;
  } finally {
    restoreDisableDirectives();
    fs.rmSync(configDirectory, { recursive: true, force: true });
  }
};
