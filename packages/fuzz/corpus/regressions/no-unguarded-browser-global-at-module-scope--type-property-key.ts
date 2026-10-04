// rule: no-unguarded-browser-global-at-module-scope
// weakness: type-position
// source: GitHub issue #1667
// verdict: pass

interface TweetSearchCoverageStrategyMetadata {
  readonly window:
    | {
        readonly sinceTime: string;
        readonly untilTime: string;
      }
    | undefined;
}

export const metadata: TweetSearchCoverageStrategyMetadata = {
  window: undefined,
};
