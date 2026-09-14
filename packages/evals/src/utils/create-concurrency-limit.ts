interface ConcurrencyLimit {
  <Result>(operation: () => Result | PromiseLike<Result>): Promise<Result>;
}

export const createConcurrencyLimit = (concurrency: number): ConcurrencyLimit => {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new TypeError("Concurrency must be a positive integer");
  }

  const pendingOperations: Array<() => void> = [];
  let nextPendingOperationIndex = 0;
  let activeOperationCount = 0;

  const startNextOperations = (): void => {
    while (activeOperationCount < concurrency) {
      const startOperation = pendingOperations[nextPendingOperationIndex];
      if (!startOperation) {
        pendingOperations.length = 0;
        nextPendingOperationIndex = 0;
        return;
      }
      nextPendingOperationIndex += 1;
      activeOperationCount += 1;
      startOperation();
    }
  };

  return <Result>(operation: () => Result | PromiseLike<Result>): Promise<Result> =>
    new Promise<Result>((resolve, reject) => {
      pendingOperations.push(() => {
        Promise.resolve()
          .then(operation)
          .then(resolve, reject)
          .finally(() => {
            activeOperationCount -= 1;
            startNextOperations();
          });
      });
      startNextOperations();
    });
};
