import * as path from "node:path";
import ts from "typescript";
import { FIRST_SOURCE_COLUMN, FIRST_SOURCE_LINE, REACT_PROOF_SCHEMA_VERSION } from "./constants.js";
import { analyzeReactUnit } from "./analyze-react-unit.js";
import { buildReactSemanticGraph } from "./build-react-semantic-graph.js";
import { checkReactProofReport } from "./check-react-proof-report.js";
import { collectProjectSoundnessEvidence } from "./collect-project-soundness-evidence.js";
import { collectReactUnits } from "./collect-react-units.js";
import {
  ReactAppProofStatus,
  ReactObligationStatus,
  ReactProofCertificateStatus,
} from "./types.js";
import type {
  ReactAnalysisContext,
  ReactAppProofReport,
  ReactProofEvidence,
  ReactProofSummary,
} from "./types.js";

const isProjectSourceFile = (sourceFile: ts.SourceFile, rootDirectory: string): boolean => {
  const relativePath = path.relative(rootDirectory, sourceFile.fileName);
  return (
    !sourceFile.isDeclarationFile &&
    !relativePath.startsWith("..") &&
    !relativePath.split(path.sep).includes("node_modules")
  );
};

const createDiagnosticEvidence = (
  diagnostic: ts.Diagnostic,
  rootDirectory: string,
): ReactProofEvidence => {
  if (diagnostic.file && diagnostic.start !== undefined) {
    const sourcePosition = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    return {
      description: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      location: {
        filePath: path.relative(rootDirectory, diagnostic.file.fileName),
        line: sourcePosition.line + 1,
        column: sourcePosition.character + 1,
      },
      trace: ["TypeScript diagnostic", "incomplete program model", "React proof"],
    };
  }
  return {
    description: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    location: {
      filePath: "tsconfig.json",
      line: FIRST_SOURCE_LINE,
      column: FIRST_SOURCE_COLUMN,
    },
    trace: ["TypeScript diagnostic", "incomplete program model", "React proof"],
  };
};

const buildSummary = (
  files: number,
  obligations: ReadonlyArray<{ status: ReactObligationStatus }>,
  unitCount: number,
): ReactProofSummary => ({
  files,
  units: unitCount,
  proved: obligations.filter((obligation) => obligation.status === ReactObligationStatus.Proved)
    .length,
  violated: obligations.filter((obligation) => obligation.status === ReactObligationStatus.Violated)
    .length,
  unknown: obligations.filter((obligation) => obligation.status === ReactObligationStatus.Unknown)
    .length,
});

const resolveAppProofStatus = (
  obligations: ReadonlyArray<{ status: ReactObligationStatus }>,
  projectEvidence: ReadonlyArray<ReactProofEvidence>,
): ReactAppProofStatus => {
  if (obligations.some((obligation) => obligation.status === ReactObligationStatus.Violated)) {
    return ReactAppProofStatus.Refuted;
  }
  if (
    projectEvidence.length > 0 ||
    obligations.some((obligation) => obligation.status === ReactObligationStatus.Unknown)
  ) {
    return ReactAppProofStatus.Incomplete;
  }
  return ReactAppProofStatus.Proved;
};

export const proveReactProgram = (
  program: ts.Program,
  rootDirectory: string,
  initialEvidence: ReadonlyArray<ReactProofEvidence> = [],
): ReactAppProofReport => {
  const typeChecker = program.getTypeChecker();
  const context: ReactAnalysisContext = { program, typeChecker, rootDirectory };
  const sourceFiles = program
    .getSourceFiles()
    .filter((sourceFile) => isProjectSourceFile(sourceFile, rootDirectory));
  const descriptors = sourceFiles.flatMap((sourceFile) =>
    collectReactUnits(sourceFile, typeChecker),
  );
  const graph = buildReactSemanticGraph(descriptors, sourceFiles, context);
  const analysisContext: ReactAnalysisContext = { ...context, graph };
  const units = [];
  for (const descriptor of descriptors) {
    units.push(analyzeReactUnit(descriptor, analysisContext));
  }
  const diagnosticEvidence: ReactProofEvidence[] = [];
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
    diagnosticEvidence.push(createDiagnosticEvidence(diagnostic, rootDirectory));
  }
  const compilerEvidence: ReactProofEvidence[] = graph.compiler.failures.map((failure) => ({
    description: `React Compiler could not produce complete proof facts: ${failure.description}`,
    location: failure.location,
    trace: ["React source", graph.compiler.phase, "incomplete semantic graph"],
  }));
  const lazyIdentityEvidence: ReactProofEvidence[] = [];
  const exportedLazyEvidence: ReactProofEvidence[] = [];
  for (const component of graph.lazyComponents) {
    if (!component.identityResolved && !component.declarationOwnerId) {
      lazyIdentityEvidence.push({
        description: `React.lazy declaration has no stable symbol identity: ${component.name}`,
        location: component.location,
        trace: ["React.lazy", "unsupported module declaration", "incomplete lazy render graph"],
      });
    }
    if (component.canBeRenderRoot) {
      exportedLazyEvidence.push({
        description: `Exported lazy component has an open Suspense topology: ${component.name}`,
        location: component.location,
        trace: ["exported React.lazy", "external render root", "unknown Suspense boundary"],
      });
    }
  }
  const unresolvedMemoEvidence: ReactProofEvidence[] = graph.memoComparators.flatMap((comparator) =>
    comparator.ownerId
      ? []
      : [
          {
            description: "React.memo has an unresolved component target",
            location: comparator.location,
            trace: [
              "React.memo",
              "unresolved component identity",
              "incomplete bailout equivalence",
            ],
          },
        ],
  );
  const projectEvidence = [
    ...initialEvidence,
    ...collectProjectSoundnessEvidence(program, sourceFiles, rootDirectory),
    ...diagnosticEvidence,
    ...compilerEvidence,
    ...lazyIdentityEvidence,
    ...exportedLazyEvidence,
    ...unresolvedMemoEvidence,
  ];
  if (units.length === 0) {
    projectEvidence.push({
      description: "No React components or hooks were discovered",
      location: {
        filePath: "tsconfig.json",
        line: FIRST_SOURCE_LINE,
        column: FIRST_SOURCE_COLUMN,
      },
      trace: ["TypeScript program", "React unit discovery", "empty proof scope"],
    });
  }
  const obligations = units.flatMap((unit) => unit.obligations);

  const report: ReactAppProofReport = {
    schemaVersion: REACT_PROOF_SCHEMA_VERSION,
    status: resolveAppProofStatus(obligations, projectEvidence),
    rootDirectory,
    graph,
    units,
    projectEvidence,
    summary: buildSummary(sourceFiles.length, obligations, units.length),
  };
  const certificate = checkReactProofReport(report);
  if (certificate.status === ReactProofCertificateStatus.Valid) return report;
  const certificateEvidence = certificate.failures.map(
    (failure): ReactProofEvidence => ({
      description: `The proof certificate is internally inconsistent: ${failure.description}`,
      location: {
        filePath: "tsconfig.json",
        line: FIRST_SOURCE_LINE,
        column: FIRST_SOURCE_COLUMN,
      },
      trace: ["proof report", failure.subjectId, "independent certificate checker"],
    }),
  );
  const checkedProjectEvidence = [...projectEvidence, ...certificateEvidence];
  return {
    ...report,
    status: resolveAppProofStatus(obligations, checkedProjectEvidence),
    projectEvidence: checkedProjectEvidence,
  };
};
