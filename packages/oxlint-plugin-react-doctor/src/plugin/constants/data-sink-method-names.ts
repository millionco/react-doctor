/**
 * Pure string / comparison reads — `props.text.startsWith(prev)`,
 * `props.path.includes(sep)`, `props.label.indexOf(x)` read FROM the
 * prop and return a primitive; they never hand the child's data back
 * to a parent callback. Split out of DATA_SINK_METHOD_NAMES because
 * these names CAN collide with a real parent callback when the method
 * is called directly on the props object (`props.search(results)`) —
 * `no-pass-data-to-parent` un-exempts exactly that shape.
 */
export const STRING_READ_METHOD_NAMES: ReadonlySet<string> = new Set([
  "startsWith",
  "endsWith",
  "includes",
  "indexOf",
  "lastIndexOf",
  "match",
  "matchAll",
  "search",
  "localeCompare",
  "test",
]);

/**
 * Method names that conventionally "consume" or "sink" the value
 * passed to them rather than handing it BACK to a parent — used by
 * `no-pass-data-to-parent` and `no-pass-live-state-to-parent` to
 * filter out call shapes that aren't actually the data-handoff
 * anti-pattern they detect.
 *
 * Was duplicated verbatim in both rule files; promoted to this
 * shared module so adding a new method name (a new EventEmitter
 * variant, a new imperative-action verb) propagates to both
 * detectors without drift.
 *
 * The previous name `ITERATOR_METHOD_NAMES` was misleading —
 * iterators are only one of the seven categories covered.
 */
export const DATA_SINK_METHOD_NAMES: ReadonlySet<string> = new Set([
  // Array.prototype iterators
  "forEach",
  "map",
  "filter",
  "reduce",
  "reduceRight",
  "flatMap",
  "some",
  "every",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  // Observer / EventEmitter / event bus patterns — these are
  // hand-off calls (the consumer keeps a subscription / dispatches
  // to subscribers) not the "pass derived data to a parent"
  // anti-pattern the rule targets.
  "subscribe",
  "unsubscribe",
  "addEventListener",
  "addListener",
  "removeEventListener",
  "removeListener",
  "on",
  "once",
  "off",
  "emit",
  "dispatch",
  "publish",
  "notify",
  "trigger",
  "fire",
  "broadcast",
  "send",
  ...STRING_READ_METHOD_NAMES,
  // Promise
  "then",
  "catch",
  "finally",
  // Set / Map / cache
  "add",
  "delete",
  "has",
  "get",
  "set",
  "clear",
  "put",
  "push",
  "pop",
  "shift",
  "unshift",
  // Logger / telemetry shapes — `props.logger.info(...)` is reporting,
  // not data hand-off.
  "log",
  "info",
  "warn",
  "error",
  "debug",
  "trace",
  "track",
  "capture",
  // Imperative action methods on stateful objects — `animationLoop.start()`,
  // `subscription.cancel()`, `controller.abort()`. The arg (if any) is
  // a configuration value, not the child's derived state.
  "start",
  "stop",
  "play",
  "pause",
  "resume",
  "cancel",
  "abort",
  "commit",
  "rollback",
  "reset",
  "focus",
  "blur",
  "scroll",
  "scrollTo",
  "scrollIntoView",
  "close",
  "open",
  "show",
  "hide",
  "expand",
  "collapse",
  "toggle",
  "refresh",
  "reload",
  "rerender",
  "refetch",
  "invalidate",
  "select",
  "deselect",
  "click",
  "press",
  "tap",
  "submit",
  "validate",
  "format",
  "parse",
  "serialize",
  "deserialize",
]);
