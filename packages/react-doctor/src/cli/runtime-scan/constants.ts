export const RUNTIME_SCAN_SCHEMA_VERSION = 1;
export const RUNTIME_SCAN_MAX_LOAF_ENTRIES = 100;
export const RUNTIME_SCAN_MAX_SCRIPTS_PER_LOAF = 100;
export const RUNTIME_SCAN_MAX_COMPONENT_EVENTS = 2_000;
export const RUNTIME_SCAN_MAX_COMPONENTS_PER_COMMIT = 250;
export const RUNTIME_SCAN_MAX_INTERACTIONS = 500;
export const RUNTIME_SCAN_MAX_HOTSPOTS = 10;
export const RUNTIME_SCAN_MIN_COMPONENT_DURATION_MS = 0.05;
export const RUNTIME_SCAN_INTERACTION_DURATION_THRESHOLD_MS = 16;
export const RUNTIME_SCAN_LAYOUT_THRASH_RATIO = 0.25;
export const RUNTIME_SCAN_BROWSER_WIDTH_PX = 1_440;
export const RUNTIME_SCAN_BROWSER_HEIGHT_PX = 900;
export const RUNTIME_SCAN_DURATION_PRECISION_DIGITS = 1;
export const RUNTIME_SCAN_TRACE_FILE_MODE = 0o600;
export const RUNTIME_SCAN_TRACE_FILE_EXTENSION = ".json.gz";
export const RUNTIME_SCAN_TRACING_COMPLETE_TIMEOUT_MS = 10_000;
export const RUNTIME_SCAN_PROBE_RELATIVE_PATH = "runtime-scan/browser-probe.iife.js";
export const RUNTIME_SCAN_PROBE_SNAPSHOT_BINDING_NAME = "__REACT_DOCTOR_RUNTIME_SCAN_CAPTURE__";
export const RUNTIME_SCAN_OVERLAY_COLOR_RGB = "115,97,230";
export const RUNTIME_SCAN_OVERLAY_FONT =
  "Menlo,Consolas,Monaco,Liberation Mono,Lucida Console,monospace";
export const RUNTIME_SCAN_OVERLAY_VISIBLE_FRAME_COUNT = 45;
export const RUNTIME_SCAN_OVERLAY_MAX_DEVICE_PIXEL_RATIO = 2;
export const RUNTIME_SCAN_OVERLAY_MAX_ACTIVE_OUTLINES = 200;
export const RUNTIME_SCAN_OVERLAY_MAX_LABEL_LENGTH = 40;
export const RUNTIME_SCAN_OVERLAY_FONT_SIZE_PX = 11;
export const RUNTIME_SCAN_OVERLAY_LABEL_PADDING_PX = 2;
export const RUNTIME_SCAN_OVERLAY_LABEL_GAP_PX = 4;
export const RUNTIME_SCAN_OVERLAY_LINE_WIDTH_PX = 1;
export const RUNTIME_SCAN_OVERLAY_FILL_ALPHA = 0.1;
export const RUNTIME_SCAN_OVERLAY_Z_INDEX = 2_147_483_646;

export const RUNTIME_SCAN_TRACE_CATEGORIES = [
  "-*",
  "blink.console",
  "blink.user_timing",
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.invalidationTracking",
  "disabled-by-default-devtools.timeline.frame",
  "disabled-by-default-devtools.timeline.stack",
  "disabled-by-default-v8.cpu_profiler",
  "disabled-by-default-v8.cpu_profiler.hires",
  "latencyInfo",
  "loading",
  "v8",
  "v8.execute",
] as const;
