export const isReactiveCaptureDeclared = (
  capture: string,
  dependencies: ReadonlyArray<string>,
): boolean =>
  dependencies.some(
    (dependency) =>
      dependency === capture ||
      capture.startsWith(`${dependency}.`) ||
      dependency.startsWith(`${capture}.`),
  );
