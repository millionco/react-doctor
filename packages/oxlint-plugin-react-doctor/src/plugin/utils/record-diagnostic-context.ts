import { atomicWriteFile } from "./atomic-write-file.js";
import { getDiagnosticContextPath } from "./get-diagnostic-context-path.js";
import { getNodeStartIndex } from "./get-node-start-index.js";
import { getNodeEndIndex } from "./get-node-end-index.js";
import type { BaseRuleContext } from "./rule-context.js";
import type { ReportDescriptor } from "./report-descriptor.js";
import type { DiagnosticContextRange } from "./diagnostic-context-range.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";

interface RecordDiagnosticContextInput {
  readonly context: BaseRuleContext;
  readonly rule: string;
  readonly descriptor: ReportDescriptor;
}

export const recordDiagnosticContext = ({
  context,
  rule,
  descriptor,
}: RecordDiagnosticContextInput): void => {
  if (!descriptor.contextNodes?.length) return;
  const directory = getReactDoctorStringSetting(context.settings, "diagnosticContextDirectory");
  const filename = context.filename ?? context.getFilename?.();
  if (!directory || !filename || !context.sourceCode?.getText) return;
  const source = context.sourceCode.getText();
  const primaryStart = getNodeStartIndex(descriptor.node);
  if (primaryStart < 0 || primaryStart >= source.length) return;
  const ranges: DiagnosticContextRange[] = [];
  for (const node of descriptor.contextNodes) {
    const start = getNodeStartIndex(node);
    const end = getNodeEndIndex(node);
    if (start < 0 || end <= start || end > source.length) continue;
    ranges.push({
      offset: Buffer.byteLength(source.slice(0, start)),
      length: Buffer.byteLength(source.slice(start, end)),
    });
  }
  if (ranges.length === 0) return;
  atomicWriteFile(
    getDiagnosticContextPath({
      directory,
      filename,
      rule,
      offset: Buffer.byteLength(source.slice(0, primaryStart)),
      message: descriptor.message,
    }),
    JSON.stringify(ranges),
  );
};
