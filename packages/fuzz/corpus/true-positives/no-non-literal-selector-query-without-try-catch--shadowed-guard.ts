// rule: no-non-literal-selector-query-without-try-catch
// weakness: binding-resolution
// source: adversarial audit of PR parsing/string-safety group

export const findHashTarget = (): Element | null => {
  const hash = location.hash;
  if (["#safe"].some((hash) => /^#[A-Za-z][\w-]*$/.test(hash))) {
    return document.querySelector(hash);
  }
  return null;
};
