export const recordEvent = (name: string): void => {
  window.dispatchEvent(new CustomEvent(name));
};
