import type { SourceFileEntry } from "../types/index.js";
import type { DuplicateJsxSubtreesResult } from "./detect-duplicate-jsx-subtrees.js";

export interface DuplicateJsxDetectionRequest {
  readonly rootDirectory: string;
  readonly sourceFiles: ReadonlyArray<SourceFileEntry>;
}

export interface DuplicateJsxWorkerDetectMessage extends DuplicateJsxDetectionRequest {
  readonly type: "detect";
  readonly id: number;
}

export interface DuplicateJsxWorkerAbortMessage {
  readonly type: "abort";
  readonly id: number;
}

export type DuplicateJsxWorkerCommand =
  | DuplicateJsxWorkerDetectMessage
  | DuplicateJsxWorkerAbortMessage;

export interface SerializedDuplicateJsxWorkerError {
  readonly name?: string;
  readonly message: string;
  readonly stack?: string;
}

export interface DuplicateJsxWorkerSuccess {
  readonly id: number;
  readonly ok: true;
  readonly result: DuplicateJsxSubtreesResult;
}

export interface DuplicateJsxWorkerFailure {
  readonly id: number;
  readonly ok: false;
  readonly error: SerializedDuplicateJsxWorkerError;
}

export type DuplicateJsxWorkerReply = DuplicateJsxWorkerSuccess | DuplicateJsxWorkerFailure;

export const isDuplicateJsxWorkerReply = (value: unknown): value is DuplicateJsxWorkerReply =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "number" &&
  "ok" in value &&
  typeof value.ok === "boolean";
