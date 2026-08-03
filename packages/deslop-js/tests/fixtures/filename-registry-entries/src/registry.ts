const registerTool = (path: string): string => path;

export const TOOL_REGISTRY = [
  { name: "diagnose-user", file: "diagnose-user.ts" },
  { name: "export-data", file: "export-data.ts" },
  { name: "nested-task", file: registerTool("tools/dynamic/nested-task") },
] as const;

export const loadDynamicTool = () => import("tools/dynamic/dynamic-import-task");
