export interface ReactCompilerDetectionRequest {
  readonly id: number;
  readonly directory: string;
}

export interface ReactCompilerDetectionReply {
  readonly id: number;
  readonly hasReactCompiler: boolean | null;
}

export const isReactCompilerDetectionRequest = (
  value: unknown,
): value is ReactCompilerDetectionRequest =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "number" &&
  "directory" in value &&
  typeof value.directory === "string";

export const isReactCompilerDetectionReply = (
  value: unknown,
): value is ReactCompilerDetectionReply =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "number" &&
  "hasReactCompiler" in value &&
  (typeof value.hasReactCompiler === "boolean" || value.hasReactCompiler === null);
