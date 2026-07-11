export interface ScanCompletionInput {
  readonly analyzedFileCount: number | undefined;
  readonly scannedFileCount: number | undefined;
  readonly skippedCheckCount: number;
  readonly skippedCheckReasonCount: number;
}

export const isScanComplete = (input: ScanCompletionInput): boolean =>
  input.analyzedFileCount !== undefined &&
  input.scannedFileCount !== undefined &&
  input.skippedCheckCount === 0 &&
  input.skippedCheckReasonCount === 0 &&
  input.analyzedFileCount === input.scannedFileCount;
