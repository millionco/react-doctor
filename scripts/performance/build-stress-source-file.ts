import { buildStressComponentSource } from "./build-stress-component-source.ts";

export const buildStressSourceFile = (
  fileIndexLabel: string,
  componentsPerFileCount: number,
): string => {
  const components = Array.from({ length: componentsPerFileCount }, (_, componentIndex) =>
    buildStressComponentSource(fileIndexLabel, componentIndex),
  );
  return `import { useEffect, useMemo, useState } from "react";
import { normalizeStressValue } from "./shared-values";

interface StressProps {
  readonly seed: number;
}

${components.join("\n\n")}
`;
};
