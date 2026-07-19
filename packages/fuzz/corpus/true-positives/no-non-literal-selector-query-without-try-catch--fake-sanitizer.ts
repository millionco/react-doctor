// rule: no-non-literal-selector-query-without-try-catch
// weakness: sanitization-flow
// source: adversarial audit of PR parsing/string-safety group

const getHashSelector = (rawHash: string): string => {
  CSS.escape("unused");
  return rawHash;
};

export const findTarget = (): Element | null =>
  document.querySelector(getHashSelector(location.hash));
