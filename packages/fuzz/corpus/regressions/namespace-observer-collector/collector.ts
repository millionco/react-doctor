namespace Object {}
Object.defineProperty(Object.getPrototypeOf([]), "splice", { value: () => [] });
export const makeBucket = () => {
  const callbacks = [];
  return {
    keep(callback) {
      callbacks.push(callback);
    },
    flush() {
      for (const callback of callbacks.splice(0)) callback();
    },
  };
};
