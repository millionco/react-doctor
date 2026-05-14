import type { Diagnostic } from "../types/diagnostic.js";
import { encodeAnnotationMessage, encodeAnnotationProperty } from "./annotation-encoding.js";

export const printAnnotations = (diagnostics: Diagnostic[], routeToStderr: boolean): void => {
  const writeLine = routeToStderr
    ? (line: string) => process.stderr.write(`${line}\n`)
    : (line: string) => process.stdout.write(`${line}\n`);
  for (const diagnostic of diagnostics) {
    const level = diagnostic.severity === "error" ? "error" : "warning";
    const title = `${diagnostic.plugin}/${diagnostic.rule}`;
    const fileSegment = `file=${encodeAnnotationProperty(diagnostic.filePath)}`;
    const lineSegment = diagnostic.line > 0 ? `,line=${diagnostic.line}` : "";
    const titleSegment = `,title=${encodeAnnotationProperty(title)}`;
    const message = encodeAnnotationMessage(diagnostic.message);
    writeLine(`::${level} ${fileSegment}${lineSegment}${titleSegment}::${message}`);
  }
};
