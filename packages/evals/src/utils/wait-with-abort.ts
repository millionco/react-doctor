export const waitWithAbort = <Result>(
  operation: Promise<Result>,
  signal?: AbortSignal,
): Promise<Result> => {
  if (!signal) return operation;
  return new Promise<Result>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
};
