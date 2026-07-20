// rule: react-router-guard-aborted-handle-error
// weakness: import-provenance
// source: adversarial contract audit of PR #1411
import * as validation from "./validation";

export const handleError = (error: Error) => {
  validation.reportError(error);
};
