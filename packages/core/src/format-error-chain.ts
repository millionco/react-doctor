const collectErrorChain = (rootError: unknown): unknown[] => {
  const errorChain: unknown[] = [];
  const visitedErrors = new Set<unknown>();
  let currentError: unknown = rootError;
  while (currentError !== undefined && !visitedErrors.has(currentError)) {
    visitedErrors.add(currentError);
    errorChain.push(currentError);
    currentError = currentError instanceof Error ? currentError.cause : undefined;
  }
  return errorChain;
};

const formatErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message || error.name : String(error);

export const formatErrorChain = (rootError: unknown): string =>
  collectErrorChain(rootError).map(formatErrorMessage).join(" → ");

export const getErrorChainMessages = (rootError: unknown): string[] =>
  collectErrorChain(rootError).map(formatErrorMessage);
