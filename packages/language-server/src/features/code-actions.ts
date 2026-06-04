import {
  CodeActionKind,
  type CodeAction,
  type Diagnostic as LspDiagnostic,
  type TextEdit,
} from "vscode-languageserver";
import { COMMAND_EXPLAIN, COMMAND_OPEN_DOCS, COMMAND_REPORT_FALSE_POSITIVE } from "../constants.js";
import type { ReactDoctorDiagnosticData } from "../types.js";
import { readDiagnosticData } from "../utils/read-diagnostic-data.js";
import { severityLabel } from "../utils/severity-label.js";
import {
  buildSuppressAllTextEdits,
  buildSuppressionTextEdit,
  type SuppressionTarget,
} from "./suppress.js";

/**
 * Namespaced source-action kind for the file-level suppress (the
 * `source.fixAll.eslint` convention) so it lands in the Source Action menu
 * rather than the bare `source` bucket. Note this kind alone is NOT enough to
 * keep it out of on-save runs: `editor.codeActionsOnSave: { "source": true }`
 * requests `only: ["source"]`, which prefix-matches this sub-kind. The server
 * guards against that by withholding this action on `Automatic`-trigger
 * requests (on-save) — see the `onCodeAction` handler.
 */
export const SUPPRESS_ALL_CODE_ACTION_KIND = "source.suppressAll.reactDoctor";

export interface BuildCodeActionsInput {
  readonly uri: string;
  readonly fsPath: string;
  readonly documentText: string | null;
  readonly relativeFilePath: string;
  /** Our diagnostics overlapping the requested range. */
  readonly rangeDiagnostics: ReadonlyArray<LspDiagnostic>;
  /** Every React Doctor diagnostic in the file (for "suppress all"). */
  readonly fileDiagnostics: ReadonlyArray<LspDiagnostic>;
}

const suppressEdit = (input: BuildCodeActionsInput, data: ReactDoctorDiagnosticData): TextEdit =>
  buildSuppressionTextEdit({
    documentText: input.documentText,
    fsPath: input.fsPath,
    line: data.line,
    ruleId: data.ruleId,
  });

/** Collects (line, ruleId) suppression targets from our diagnostics. */
export const collectSuppressionTargets = (
  diagnostics: ReadonlyArray<LspDiagnostic>,
): SuppressionTarget[] => {
  const targets: SuppressionTarget[] = [];
  for (const diagnostic of diagnostics) {
    const data = readDiagnosticData(diagnostic);
    if (data) targets.push({ line: data.line, ruleId: data.ruleId });
  }
  return targets;
};

/**
 * Builds the code actions offered for React Doctor diagnostics: per
 * finding a "disable for this line" quick fix plus explain / docs /
 * report commands, and a file-level "suppress all" source action. Rule-
 * authored autofixes will slot in here as additional `QuickFix` edits.
 */
export const buildCodeActions = (input: BuildCodeActionsInput): CodeAction[] => {
  const actions: CodeAction[] = [];

  for (const diagnostic of input.rangeDiagnostics) {
    const data = readDiagnosticData(diagnostic);
    if (!data) continue;

    actions.push({
      title: `Disable ${data.ruleId} for this line`,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      edit: { changes: { [input.uri]: [suppressEdit(input, data)] } },
    });

    actions.push({
      title: `Explain ${data.ruleId}`,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      command: {
        title: "Explain",
        command: COMMAND_EXPLAIN,
        arguments: [{ uri: input.uri, identity: data.identity }],
      },
    });

    if (data.url) {
      actions.push({
        title: `Open ${data.ruleId} documentation`,
        kind: CodeActionKind.QuickFix,
        command: { title: "Open documentation", command: COMMAND_OPEN_DOCS, arguments: [data.url] },
      });
    }

    actions.push({
      title: `Report ${data.ruleId} as a false positive`,
      kind: CodeActionKind.QuickFix,
      command: {
        title: "Report false positive",
        command: COMMAND_REPORT_FALSE_POSITIVE,
        arguments: [
          {
            ruleId: data.ruleId,
            severity: severityLabel(diagnostic.severity),
            category: data.category,
            message: diagnostic.message,
            relativeFilePath: input.relativeFilePath,
            line: data.line,
          },
        ],
      },
    });
  }

  const suppressAllEdits = buildSuppressAllTextEdits({
    documentText: input.documentText,
    fsPath: input.fsPath,
    targets: collectSuppressionTargets(input.fileDiagnostics),
  });
  if (suppressAllEdits.length > 0) {
    actions.push({
      title: "Suppress all React Doctor issues in this file",
      kind: SUPPRESS_ALL_CODE_ACTION_KIND,
      edit: { changes: { [input.uri]: suppressAllEdits } },
    });
  }

  return actions;
};
