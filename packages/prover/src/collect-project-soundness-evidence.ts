import * as path from "node:path";
import ts from "typescript";
import { FIRST_SOURCE_COLUMN, FIRST_SOURCE_LINE } from "./constants.js";
import { createEvidence } from "./create-evidence.js";
import type { ReactProofEvidence } from "./types.js";

const TYPESCRIPT_SUPPRESSION_PATTERN = /@ts-(?:check|expect-error|ignore|nocheck)/;

export const collectProjectSoundnessEvidence = (
  program: ts.Program,
  sourceFiles: ReadonlyArray<ts.SourceFile>,
  rootDirectory: string,
): ReadonlyArray<ReactProofEvidence> => {
  const evidence: ReactProofEvidence[] = [];
  const compilerOptions = program.getCompilerOptions();
  if (compilerOptions.strict !== true) {
    evidence.push({
      description: "The React proof requires TypeScript strict mode",
      location: {
        filePath: "tsconfig.json",
        line: FIRST_SOURCE_LINE,
        column: FIRST_SOURCE_COLUMN,
      },
      trace: ["TypeScript configuration", "strict mode disabled", "unsound proof boundary"],
    });
  }
  for (const sourceFile of sourceFiles) {
    const fileExtension = path.extname(sourceFile.fileName);
    if (fileExtension === ".js" || fileExtension === ".jsx") {
      evidence.push(
        createEvidence(
          sourceFile,
          rootDirectory,
          "JavaScript source does not provide the type evidence required for a complete proof",
          ["project source", fileExtension, "untyped proof region"],
        ),
      );
    }
    if (TYPESCRIPT_SUPPRESSION_PATTERN.test(sourceFile.getFullText())) {
      evidence.push(
        createEvidence(
          sourceFile,
          rootDirectory,
          "A TypeScript suppression comment invalidates the proof boundary",
          ["project source", "TypeScript suppression", "unchecked program region"],
        ),
      );
    }
    const visit = (node: ts.Node): void => {
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        evidence.push(
          createEvidence(
            node,
            rootDirectory,
            "The any type erases evidence required by the React proof",
            ["TypeScript type", "any", "unknown runtime behavior"],
          ),
        );
      }
      if (
        (ts.isAsExpression(node) && node.type.getText() !== "const") ||
        ts.isTypeAssertionExpression(node)
      ) {
        evidence.push(
          createEvidence(
            node,
            rootDirectory,
            "An unchecked type assertion can forge a React proof fact",
            ["TypeScript expression", "type assertion", "unverified runtime value"],
          ),
        );
      }
      if (ts.isNonNullExpression(node)) {
        evidence.push(
          createEvidence(
            node,
            rootDirectory,
            "A non-null assertion removes a required runtime possibility",
            ["TypeScript expression", "non-null assertion", "unverified runtime value"],
          ),
        );
      }
      node.forEachChild(visit);
    };
    sourceFile.forEachChild(visit);
  }
  return evidence;
};
