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

export interface ReactDoctorEvaluationProvenance {
  reactDoctorRepository: string;
  reactDoctorCommit: string;
  configContract: string;
  ruleSetHash: string;
  ruleKeys: ReadonlyArray<string>;
}

export interface EvaluationProvenance extends ReactDoctorEvaluationProvenance {
  evaluatorSourceHash: string;
}

export interface CorpusEvaluationRecord {
  schemaVersion: number;
  repository: CorpusRepository;
  evaluation?: EvaluationProvenance;
  report?: unknown;
  error?: string;
}
