import type { PreparedSourceMap } from "./prepare-lint-sources.js";
import { mapPreparedSourceSpan } from "./map-prepared-source-span.js";
import type { PreparedSourceSpan } from "./map-prepared-source-span.js";

export interface PreparedSourceLabel {
  readonly label: string;
  readonly span: PreparedSourceSpan;
}

export const mapPreparedSourceLabels = (
  labels: ReadonlyArray<PreparedSourceLabel>,
  preparedSourceMap: PreparedSourceMap,
): PreparedSourceLabel[] | null => {
  const primaryLabel = labels[0];
  if (primaryLabel === undefined) return null;
  const primarySpan = mapPreparedSourceSpan(primaryLabel.span, preparedSourceMap);
  if (primarySpan === null) return null;
  const mappedLabels: PreparedSourceLabel[] = [{ ...primaryLabel, span: primarySpan }];
  for (const relatedLabel of labels.slice(1)) {
    const relatedSpan = mapPreparedSourceSpan(relatedLabel.span, preparedSourceMap);
    if (relatedSpan !== null) mappedLabels.push({ ...relatedLabel, span: relatedSpan });
  }
  return mappedLabels;
};
