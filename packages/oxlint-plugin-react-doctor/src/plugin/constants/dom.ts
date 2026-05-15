export const BARREL_INDEX_SUFFIXES = [
  "/index",
  "/index.js",
  "/index.ts",
  "/index.tsx",
  "/index.mjs",
];
export const PASSIVE_EVENT_NAMES = new Set([
  "scroll",
  "wheel",
  "touchstart",
  "touchmove",
  "touchend",
]);

export const SCRIPT_LOADING_ATTRIBUTES = new Set(["defer", "async"]);

export const EXECUTABLE_SCRIPT_TYPES = new Set([
  "text/javascript",
  "application/javascript",
  "module",
]);

// Direct CallExpression callees that schedule a callback to run later,
// outside the current render's microtask. Two distinct rules consume this
// set, so the names below intentionally describe the shape (timers and
// schedulers) rather than either rule's interpretation.
//
// Consumers:
//   - `prefer-use-effect-event` treats them as "sub-handler" boundaries:
//     calling a reactive value from inside the scheduled callback is the
//     classic case for `useEffectEvent` (see "Separating Events from
//     Effects").
//   - `no-effect-chain` treats them as external-sync direct callees so a
//     useEffect that only schedules timers is exempt from the chain rule.
export const TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES = new Set([
  "setTimeout",
  "setInterval",
  "requestAnimationFrame",
  "requestIdleCallback",
  "queueMicrotask",
]);

// Timer registrations that ALWAYS need a corresponding cleanup call
// (a stricter subset of the scheduler list above — `requestAnimationFrame`
// and friends already invoke once and self-clean, but `setTimeout` /
// `setInterval` keep firing until explicitly cleared).
export const TIMER_CALLEE_NAMES_REQUIRING_CLEANUP = new Set(["setInterval", "setTimeout"]);

export const TIMER_CLEANUP_CALLEE_NAMES = new Set(["clearInterval", "clearTimeout"]);

// Globals whose values mutate outside the React data flow. Listing
// them as deps doesn't trigger a re-run when they change because
// React compares deps with `Object.is` during render — and the read
// happens during render, before the mutation. From "Lifecycle of
// Reactive Effects" — Can global or mutable values be dependencies?
export const MUTABLE_GLOBAL_ROOTS = new Set([
  "location",
  "window",
  "document",
  "navigator",
  "history",
  "screen",
  "performance",
]);

export const EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS = new Set([
  "IntersectionObserver",
  "MutationObserver",
  "ResizeObserver",
  "PerformanceObserver",
]);

export const STORAGE_OBJECTS = new Set(["localStorage", "sessionStorage"]);
