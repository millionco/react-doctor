import { getNodeLocation } from "./get-node-location.js";
import type { ReactAnalysisContext, ReactSemanticUnit, ReactUnitDescriptor } from "./types.js";

export const findSemanticUnit = (
  unit: ReactUnitDescriptor,
  context: ReactAnalysisContext,
): ReactSemanticUnit | null => {
  const unitLocation = getNodeLocation(unit.node, context.rootDirectory);
  return (
    context.graph?.units.find(
      (semanticUnit) =>
        semanticUnit.name === unit.name &&
        semanticUnit.location.filePath === unitLocation.filePath &&
        semanticUnit.location.line === unitLocation.line &&
        semanticUnit.location.column === unitLocation.column,
    ) ?? null
  );
};
