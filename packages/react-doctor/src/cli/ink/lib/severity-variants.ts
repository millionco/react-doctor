import isUnicodeSupported from "is-unicode-supported";

export type Severity = "error" | "warning";

export interface SeverityVariant {
  readonly color: string;
  readonly icon: string;
  readonly label: string;
}

const ICONS: Readonly<Record<Severity, string>> = isUnicodeSupported()
  ? { error: "✖", warning: "⚠" }
  : { error: "x", warning: "!" };

export const severityVariant = (severity: Severity): SeverityVariant =>
  severity === "error"
    ? { color: "red", icon: ICONS.error, label: "error" }
    : { color: "yellow", icon: ICONS.warning, label: "warning" };
