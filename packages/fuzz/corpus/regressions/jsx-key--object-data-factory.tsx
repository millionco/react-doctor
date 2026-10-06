// rule: jsx-key
// weakness: data-container
// source: source-reviewed catalog factory
declare const Example: () => null;

export const catalog = {
  name: "Examples",
  data: () => [<Example />, <Example />],
};
