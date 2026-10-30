// rule: effect-observer-needs-disconnect
// weakness: cross-file
// source: synthetic closed callback collector
export const makeBucket = () => {
  const callbacks: Array<() => void> = [];
  return {
    keep(callback: () => void) {
      callbacks.push(callback);
    },
    flush() {
      for (const callback of callbacks.splice(0)) callback();
    },
  };
};
