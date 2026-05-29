/**
 * Test helper that overrides a single `process.stdin` property (e.g.
 * `isTTY`, `unref`) for the duration of one test and returns a restore
 * function the caller should run in `afterEach`. `process.stdin`
 * exposes these as non-writable getters / inherited methods, so the
 * override goes through `Object.defineProperty`; restore reinstates the
 * original own-descriptor, or deletes the own property when stdin had
 * none (the value was inherited from the prototype).
 */
export const stubProcessStdinProperty = (property: string, value: unknown): (() => void) => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(process.stdin, property);
  Object.defineProperty(process.stdin, property, { value, configurable: true });
  return () => {
    if (originalDescriptor) {
      Object.defineProperty(process.stdin, property, originalDescriptor);
    } else {
      delete (process.stdin as unknown as Record<string, unknown>)[property];
    }
  };
};
