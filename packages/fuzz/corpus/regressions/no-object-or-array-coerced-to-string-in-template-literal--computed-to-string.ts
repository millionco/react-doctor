// rule: no-object-or-array-coerced-to-string-in-template-literal
// weakness: dynamic-computed
// source: adversarial audit of PR parsing/string-safety group

const point = {
  x: 1,
  ["toString"]() {
    return String(this.x);
  },
};

export const label = `point: ${point}`;
