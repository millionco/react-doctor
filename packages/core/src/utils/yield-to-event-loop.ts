// Resolves on the next event-loop iteration so pending I/O callbacks can run
// between synchronous chunks of a long CPU pass — e.g. lint subprocess
// stdout/close events and concurrently-scanning sibling projects' git/network.
// `setImmediate` (check phase, after the I/O/poll phase) rather than a
// microtask, which would drain before any I/O and so wouldn't unblock them.
export const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });
