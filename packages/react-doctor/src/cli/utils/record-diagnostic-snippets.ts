import * as fs from "node:fs";
import * as Sentry from "@sentry/node";
import { getDiagnosticRuleIdentity, utf8OffsetToUtf16 } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";
import { isSentryTracingEnabled } from "../../instrument.js";
import { SCRAMBLED_SNIPPET_LIMIT, SCRAMBLED_SNIPPET_SCAN_LIMIT } from "./constants.js";
import { resolveAbsolutePath } from "./resolve-absolute-path.js";
import { scramble, type ScrambleOptions } from "./scramble-snippet.js";

export interface ScrambledDiagnosticSnippet {
  readonly rule: string;
  readonly plugin: string;
  readonly category: string;
  readonly severity: string;
  /** Structure-only source: identifiers/literals blinded, shape preserved. */
  readonly source: string;
  /** Stable structural fingerprint, used to dedupe and group identical shapes. */
  readonly hash: string;
  readonly nodeType: string | null;
}

const LANGUAGE_BY_EXTENSION: Record<string, ScrambleOptions["language"]> = {
  ts: "ts",
  mts: "ts",
  cts: "ts",
  tsx: "tsx",
  js: "js",
  mjs: "js",
  cjs: "js",
  jsx: "jsx",
};

const languageForPath = (filePath: string): ScrambleOptions["language"] =>
  LANGUAGE_BY_EXTENSION[filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase()];

/**
 * Scrambles a capped, deduplicated sample of the scan's diagnostics into
 * anonymized structural snippets. Pure and exported so the sampling + offset
 * conversion is unit-testable without a filesystem or Sentry client: `readSource`
 * is injected (returns null when a file can't be read).
 *
 * Each diagnostic's `offset`/`length` are oxlint UTF-8 byte offsets, so they're
 * converted to UTF-16 code units before `scramble` (which slices the source and
 * matches oxc AST spans, both UTF-16). Snippets are deduped by structural hash
 * and capped at `SCRAMBLED_SNIPPET_LIMIT`; at most `SCRAMBLED_SNIPPET_SCAN_LIMIT`
 * diagnostics are inspected so a large result set never scrambles every site.
 */
export const buildScrambledDiagnosticSnippets = (
  diagnostics: ReadonlyArray<Diagnostic>,
  readSource: (filePath: string) => string | null,
): ScrambledDiagnosticSnippet[] => {
  const snippets: ScrambledDiagnosticSnippet[] = [];
  const seenHashes = new Set<string>();
  const sourceByPath = new Map<string, string | null>();
  let inspected = 0;

  for (const diagnostic of diagnostics) {
    if (snippets.length >= SCRAMBLED_SNIPPET_LIMIT) break;
    if (inspected >= SCRAMBLED_SNIPPET_SCAN_LIMIT) break;
    if (diagnostic.offset === undefined || diagnostic.length === undefined) continue;
    inspected += 1;

    let source = sourceByPath.get(diagnostic.filePath);
    if (source === undefined) {
      source = readSource(diagnostic.filePath);
      sourceByPath.set(diagnostic.filePath, source);
    }
    if (source === null) continue;

    const startUtf16 = utf8OffsetToUtf16(source, diagnostic.offset);
    const endUtf16 = utf8OffsetToUtf16(source, diagnostic.offset + diagnostic.length);
    const scrambled = scramble(source, {
      language: languageForPath(diagnostic.filePath),
      diagnostic: { offset: startUtf16, length: endUtf16 - startUtf16 },
    });
    if (scrambled === null || seenHashes.has(scrambled.hash)) continue;
    seenHashes.add(scrambled.hash);

    const { ruleKey, category } = getDiagnosticRuleIdentity(diagnostic);
    snippets.push({
      rule: ruleKey,
      plugin: diagnostic.plugin,
      category,
      severity: diagnostic.severity,
      source: scrambled.source,
      hash: scrambled.hash,
      nodeType: scrambled.nodeType,
    });
  }

  return snippets;
};

/**
 * Emits the anonymized diagnostic snippets as one child span per distinct
 * snippet under the run transaction, so the structural shape of what rules fire
 * on is queryable in Sentry's Trace Explorer without ever shipping real source.
 * A no-op when Sentry tracing is off (the snippets only make sense as children
 * of the run span), and the whole pass is wrapped so a read/parse failure can
 * never break a scan. The scrambled `source` carries no identifiers or literals,
 * and the transaction still passes through `scrubSentryEvent` before send.
 */
export const recordDiagnosticSnippets = (input: {
  diagnostics: ReadonlyArray<Diagnostic>;
  rootDirectory: string;
}): void => {
  if (!isSentryTracingEnabled()) return;
  try {
    const snippets = buildScrambledDiagnosticSnippets(input.diagnostics, (filePath) => {
      try {
        return fs.readFileSync(resolveAbsolutePath(filePath, input.rootDirectory), "utf8");
      } catch {
        return null;
      }
    });
    for (const snippet of snippets) {
      Sentry.startInactiveSpan({
        name: "react-doctor diagnostic snippet",
        op: "diagnostic.snippet",
        attributes: {
          rule: snippet.rule,
          plugin: snippet.plugin,
          category: snippet.category,
          severity: snippet.severity,
          "snippet.hash": snippet.hash,
          "snippet.nodeType": snippet.nodeType ?? "unknown",
          "snippet.source": snippet.source,
        },
      }).end();
    }
  } catch {
    // Telemetry must never break a scan — drop the whole snippet pass on any
    // read/parse/span failure.
  }
};
