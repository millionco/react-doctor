export interface DiagnosticInput {
  filePath: string;
  plugin: string;
  rule: string;
  severity: "error" | "warning";
  message: string;
  help: string;
  line: number;
  column: number;
  category: string;
  weight?: number;
}

export const isValidScoreApiDiagnostic = (value: unknown): value is DiagnosticInput => {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof Reflect.get(value, "filePath") === "string" &&
    typeof Reflect.get(value, "plugin") === "string" &&
    typeof Reflect.get(value, "rule") === "string" &&
    (Reflect.get(value, "severity") === "error" || Reflect.get(value, "severity") === "warning") &&
    typeof Reflect.get(value, "message") === "string" &&
    typeof Reflect.get(value, "help") === "string" &&
    typeof Reflect.get(value, "line") === "number" &&
    typeof Reflect.get(value, "column") === "number" &&
    typeof Reflect.get(value, "category") === "string"
  );
};
