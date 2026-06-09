export interface FormatListOptions {
  conjunction?: string;
  oxford?: boolean;
}

// Joins a list into a human sentence, with an optional Oxford comma.
export const formatList = (items: readonly string[], options: FormatListOptions = {}): string => {
  const conjunction = options.conjunction ?? "and";
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;

  const head = items.slice(0, -1).join(", ");
  const last = items[items.length - 1];
  const oxfordComma = options.oxford ? "," : "";
  return `${head}${oxfordComma} ${conjunction} ${last}`;
};
