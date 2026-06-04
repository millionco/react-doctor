/**
 * Dedicated language-server entry for `react-doctor experimental-lsp`. The bin
 * shim fast-paths to this module so the server runs without loading the CLI
 * (commander / prompts / ora), which would otherwise touch `process.stdin`
 * before the LSP connection attaches and break the stdio transport.
 *
 * This thin wrapper is where Sentry telemetry is wired in: the language-server
 * package stays backend-agnostic (it only calls the injected `Telemetry`
 * seam), and the published CLI supplies the Sentry-backed implementation here.
 */
import { startLanguageServer as startServer } from "@react-doctor/language-server";
import { createLspTelemetry, initializeLspSentry } from "./lsp-telemetry.js";
import { VERSION } from "./cli/utils/version.js";

export const startLanguageServer = (): void => {
  initializeLspSentry(VERSION);
  startServer({ telemetry: createLspTelemetry() });
};
