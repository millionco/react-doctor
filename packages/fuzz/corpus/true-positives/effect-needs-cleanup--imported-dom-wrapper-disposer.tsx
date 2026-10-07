// rule: effect-needs-cleanup
// weakness: library-idiom
// source: PR #1559 generated ownership matrix
// verdict: fail

import { document as importedDocument } from "global-jsdom";
import { useEffect } from "react";

export const ImportedDomWrapperDisposer = () => {
  useEffect(() => {
    const dispose = importedDocument.addEventListener("change", () => {});
    return () => dispose();
  }, []);

  return null;
};
