// Runs an async operation, retrying on rejection up to `attempts` total calls.
// Implemented recursively so each retry chains off the previous failure without
// awaiting inside a loop.
export const retryAsync = async <Value>(
  operation: () => Promise<Value>,
  attempts: number,
): Promise<Value> => {
  const maxAttempts = Math.max(1, Math.floor(attempts));

  const attempt = (remaining: number): Promise<Value> =>
    operation().catch((error: unknown) => {
      if (remaining <= 1) throw error;
      return attempt(remaining - 1);
    });

  return attempt(maxAttempts);
};
