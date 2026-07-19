// rule: no-unsafe-json-parse
// weakness: async-control-flow
// source: adversarial audit of PR parsing/string-safety group

export const registerReader = (button: HTMLButtonElement, raw: string): void => {
  try {
    button.addEventListener("click", () => JSON.parse(raw).value);
  } catch {}
};
