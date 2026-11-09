export const CLOSED_JSON_SNAPSHOT_LOCALE_MAX_NODES = 100_000;
export const CLOSED_JSON_SNAPSHOT_LOCALE_MAX_REFERENCES = 1_000;
export const CLOSED_JSON_SNAPSHOT_LOCALE_PROVIDER_SOURCES: ReadonlySet<string> = new Set([
  "antd/lib/locale-provider",
  "antd/es/locale-provider",
]);
export const CLOSED_JSON_SNAPSHOT_LOCALE_DATA_SOURCES: ReadonlySet<string> = new Set([
  "antd/lib/locale-provider/en_US",
  "antd/lib/locale-provider/zh_CN",
  "antd/es/locale-provider/en_US",
  "antd/es/locale-provider/zh_CN",
]);
export const CLOSED_JSON_SNAPSHOT_LOCALE_STYLE_SOURCES: ReadonlySet<string> = new Set([
  "antd/dist/antd.css",
  "antd/dist/antd.min.css",
]);
export const CLOSED_JSON_SNAPSHOT_LOCALE_FUNCTION_SCOPE_KINDS: ReadonlySet<string> = new Set([
  "module",
  "function",
  "arrow-function",
]);
