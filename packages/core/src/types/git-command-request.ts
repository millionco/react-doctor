export interface GitCommandRequest {
  readonly directory: string;
  readonly args: ReadonlyArray<string>;
  readonly maxBufferBytes: number;
}
