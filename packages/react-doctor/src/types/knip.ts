interface KnipIssue {
  filePath: string;
  symbol: string;
  type: string;
}

export interface KnipIssueRecords {
  [workspace: string]: {
    [filePath: string]: KnipIssue;
  };
}

export interface KnipResults {
  issues: {
    files: KnipIssueRecords | Set<string> | string[];
    dependencies: KnipIssueRecords;
    devDependencies: KnipIssueRecords;
    unlisted: KnipIssueRecords;
    exports: KnipIssueRecords;
    types: KnipIssueRecords;
    duplicates: KnipIssueRecords;
  };
  counters: Record<string, number>;
}
