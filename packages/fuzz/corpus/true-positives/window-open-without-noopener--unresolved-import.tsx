// rule: window-open-without-noopener
// weakness: unresolved-import
import { documentationUrl } from "./missing-links";

export const openImportedDestination = () => {
  window.open(documentationUrl);
};
