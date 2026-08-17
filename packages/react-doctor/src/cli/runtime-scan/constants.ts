export const RUNTIME_SCAN_SCHEMA_VERSION = 1;
export const RUNTIME_SCAN_MAX_LOAF_ENTRIES = 100;
export const RUNTIME_SCAN_MAX_SCRIPTS_PER_LOAF = 100;
export const RUNTIME_SCAN_MAX_COMPONENT_EVENTS = 2_000;
export const RUNTIME_SCAN_MAX_COMPONENTS_PER_COMMIT = 250;
export const RUNTIME_SCAN_MAX_INTERACTIONS = 500;
export const RUNTIME_SCAN_MAX_HOTSPOTS = 10;
export const RUNTIME_SCAN_MAX_DOCUMENT_SNAPSHOTS = 10;
export const RUNTIME_SCAN_MAX_SNAPSHOT_PAYLOAD_BYTES = 5 * 1_024 * 1_024;
export const RUNTIME_SCAN_SNAPSHOT_ENVELOPE_RESERVE_BYTES = 64 * 1_024;
export const RUNTIME_SCAN_MAX_SNAPSHOT_BYTES =
  RUNTIME_SCAN_MAX_SNAPSHOT_PAYLOAD_BYTES - RUNTIME_SCAN_SNAPSHOT_ENVELOPE_RESERVE_BYTES;
export const RUNTIME_SCAN_SNAPSHOT_CATEGORY_BUDGET_BYTES = Math.floor(
  RUNTIME_SCAN_MAX_SNAPSHOT_BYTES / 3,
);
export const RUNTIME_SCAN_MAX_TRACE_BYTES = 512 * 1_024 * 1_024;
export const RUNTIME_SCAN_MAX_STRING_LENGTH = 4_096;
export const RUNTIME_SCAN_UNKNOWN_SOURCE_CHAR_POSITION = -1;
export const RUNTIME_SCAN_MIN_COMPONENT_DURATION_MS = 0.05;
export const RUNTIME_SCAN_INTERACTION_DURATION_THRESHOLD_MS = 16;
export const RUNTIME_SCAN_LAYOUT_THRASH_RATIO = 0.25;
export const RUNTIME_SCAN_MAX_RECORDING_DURATION_MS = 5 * 60 * 1_000;
export const RUNTIME_SCAN_SNAPSHOT_TIMEOUT_MS = 10_000;
export const RUNTIME_SCAN_LOCAL_SERVER_PROBE_TIMEOUT_MS = 300;
export const RUNTIME_SCAN_PROMPT_MAX_WIDTH_COLUMNS = 72;
export const RUNTIME_SCAN_PROMPT_PADDING_COLUMNS = 1;
export const RUNTIME_SCAN_PROMPT_SECTION_GAP_ROWS = 1;
export const RUNTIME_SCAN_LOCAL_DEV_PORTS = [
  1_234,
  ...Array.from({ length: 11 }, (_unusedValue, portOffset) => 3_000 + portOffset),
  ...Array.from({ length: 11 }, (_unusedValue, portOffset) => 4_000 + portOffset),
  4_173,
  4_200,
  4_321,
  ...Array.from({ length: 11 }, (_unusedValue, portOffset) => 5_000 + portOffset),
  ...Array.from({ length: 11 }, (_unusedValue, portOffset) => 5_173 + portOffset),
  ...Array.from({ length: 11 }, (_unusedValue, portOffset) => 8_000 + portOffset),
  ...Array.from({ length: 11 }, (_unusedValue, portOffset) => 8_080 + portOffset),
  8_888,
] as const;
export const RUNTIME_SCAN_BROWSER_WIDTH_PX = 1_440;
export const RUNTIME_SCAN_BROWSER_HEIGHT_PX = 900;
export const RUNTIME_SCAN_DURATION_PRECISION_DIGITS = 1;
export const RUNTIME_SCAN_TRACE_FILE_MODE = 0o600;
export const RUNTIME_SCAN_TRACE_FILE_EXTENSION = ".json.gz";
export const RUNTIME_SCAN_TRACING_COMPLETE_TIMEOUT_MS = 10_000;
export const RUNTIME_SCAN_PROBE_RELATIVE_PATH = "runtime-scan/browser-probe.iife.js";
export const RUNTIME_SCAN_PROBE_SNAPSHOT_BINDING_NAME_PLACEHOLDER =
  "__REACT_DOCTOR_RUNTIME_SCAN_CAPTURE__";
export const RUNTIME_SCAN_PROBE_SNAPSHOT_ATTRIBUTE_NAME_PLACEHOLDER =
  "data-react-doctor-runtime-scan-snapshot";
export const RUNTIME_SCAN_PROBE_SNAPSHOT_TOKEN_PLACEHOLDER = "__REACT_DOCTOR_RUNTIME_SCAN_TOKEN__";
export const RUNTIME_SCAN_SAFE_CDP_PAGE_URLS = [
  "about:blank",
  "chrome://newtab/",
  "chrome://new-tab-page/",
] as const;
export const RUNTIME_SCAN_OVERLAY_COLOR_RGB = "115,97,230";
export const RUNTIME_SCAN_OVERLAY_FONT =
  "Menlo,Consolas,Monaco,Liberation Mono,Lucida Console,monospace";
export const RUNTIME_SCAN_OVERLAY_VISIBLE_FRAME_COUNT = 45;
export const RUNTIME_SCAN_OVERLAY_MAX_DEVICE_PIXEL_RATIO = 2;
export const RUNTIME_SCAN_OVERLAY_MAX_ACTIVE_OUTLINES = 200;
export const RUNTIME_SCAN_OVERLAY_MAX_HOST_ELEMENTS = 20;
export const RUNTIME_SCAN_OVERLAY_MAX_LABEL_LENGTH = 40;
export const RUNTIME_SCAN_OVERLAY_FONT_SIZE_PX = 11;
export const RUNTIME_SCAN_OVERLAY_LABEL_PADDING_PX = 2;
export const RUNTIME_SCAN_OVERLAY_LABEL_GAP_PX = 4;
export const RUNTIME_SCAN_OVERLAY_LINE_WIDTH_PX = 1;
export const RUNTIME_SCAN_OVERLAY_FILL_ALPHA = 0.1;
export const RUNTIME_SCAN_OVERLAY_Z_INDEX = 2_147_483_646;
export const RUNTIME_SCAN_CONTROL_CHARACTERS_PATTERN = /[\u0000-\u001f\u007f-\u009f]/g;

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
