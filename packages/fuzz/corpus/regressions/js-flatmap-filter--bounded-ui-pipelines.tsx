// rule: js-flatmap-filter
// weakness: cost-model
// source: ISSUES_TO_FIX_ASAP.md (bounded ancestry and URL-token pipelines)
interface Level {
  selected?: string;
}

export const collectSelections = (levels: Level[], index: number, search: string) => ({
  ancestors: levels
    .slice(0, index)
    .map((level) => level.selected)
    .filter(Boolean),
  tokens: search
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean),
});
