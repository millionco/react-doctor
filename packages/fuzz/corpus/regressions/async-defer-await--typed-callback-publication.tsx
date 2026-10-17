// rule: async-defer-await
// verdict: pass
// weakness: type-value-binding
// source: synthetic
export const runView = async (execute) => {
  const sink = {};
  interface sink {}
  const paint = () => {
    sink.url = "/next";
  };
  type paint = unknown;
  const result = await execute({ paint });
  if (sink.url) return null;
  return result;
};
