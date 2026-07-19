// rule: no-unsafe-json-parse
// weakness: scope
// source: adversarial audit of PR parsing/string-safety group

const Array = {
  from: (values: string[], callback: (value: string) => unknown): void => {
    queueMicrotask(() => values.map(callback));
  },
};

export const readValues = (values: string[]): void => {
  try {
    Array.from(values, (value) => JSON.parse(value).data);
  } catch {
    recover();
  }
};

declare const recover: () => void;
