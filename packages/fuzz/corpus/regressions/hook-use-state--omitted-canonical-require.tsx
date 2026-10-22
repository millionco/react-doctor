// rule: hook-use-state
// verdict: pass
// weakness: library-idiom
// source: synthetic direct CommonJS provider
const React = require("react");

export const useRetainedKey = () => {
  const [retainedKey] = React.useState("initial");
  return retainedKey;
};
