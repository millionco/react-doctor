// rule: js-combine-iterations
// weakness: cost-model
// source: ReactBench RDFPFN792026 confirmed false-positive partition

export const REQUIREMENT_COLUMNS = [
  { key: "sortOrder", resizable: true },
  { key: "family", resizable: true },
  { key: "identifier", resizable: true },
  { key: "name", resizable: true },
  { key: "description", resizable: true },
  { key: "controls", resizable: true },
  { key: "createdAt", resizable: true },
  { key: "updatedAt", resizable: true },
  { key: "actions", resizable: false },
] as const;

export const RESIZABLE_REQUIREMENT_KEYS = REQUIREMENT_COLUMNS.filter(
  (column) => column.resizable,
).map((column) => column.key);

export const getSelectedSideLabels = (selectedSides: Record<string, string>) => {
  var sides = ["top", "right", "bottom", "left", "horizontal", "vertical"];
  return sides
    .filter((side) => selectedSides[side])
    .map((side) => `${side}-${selectedSides[side]}`);
};
