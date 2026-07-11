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
