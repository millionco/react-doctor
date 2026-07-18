export interface CorpusRepository {
  org: string;
  name: string;
  ref: string;
  rootDir: string;
}

export interface CorpusRepositoryGroup {
  org: string;
  name: string;
  ref: string;
  rootDirectories: ReadonlyArray<string>;
}

export interface CorpusEvaluationRecord {
  schemaVersion: number;
  repository: CorpusRepository;
  report?: unknown;
  error?: string;
}
