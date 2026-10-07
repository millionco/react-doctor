export interface OxlintWorkerSpawnSpec {
  readonly nodeBinaryPath: string;
  readonly args: ReadonlyArray<string>;
  readonly environment: NodeJS.ProcessEnv;
}
