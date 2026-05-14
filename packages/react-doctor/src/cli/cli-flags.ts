export interface CliFlags {
  lint: boolean;
  deadCode: boolean;
  verbose: boolean;
  score: boolean;
  json: boolean;
  jsonCompact: boolean;
  yes: boolean;
  full: boolean;
  offline: boolean;
  annotations: boolean;
  staged: boolean;
  respectInlineDisables: boolean;
  project?: string;
  diff?: boolean | string;
  explain?: string;
  why?: string;
  failOn: string;
}
