export type { Diagnostic, ProjectInfo, ReactDoctorConfig, ScoreResult } from "./types.js";
export { calculateScore, calculateScoreLocally } from "./utils/calculate-score-browser.js";
export type { BrowserDiagnoseInput, BrowserDiagnoseResult } from "./adapters/browser/diagnose.js";
export { diagnose } from "./adapters/browser/diagnose.js";
export type { DiagnoseCoreOptions, DiagnoseCoreResult } from "./core/diagnose-core.js";
export { diagnoseCore } from "./core/diagnose-core.js";
export type { DiagnoseBrowserInput } from "./adapters/browser/diagnose-browser.js";
export { diagnoseBrowser } from "./adapters/browser/diagnose-browser.js";
export type {
  ProcessBrowserDiagnosticsInput,
  ProcessBrowserDiagnosticsResult,
} from "./adapters/browser/process-browser-diagnostics.js";
export { processBrowserDiagnostics } from "./adapters/browser/process-browser-diagnostics.js";
