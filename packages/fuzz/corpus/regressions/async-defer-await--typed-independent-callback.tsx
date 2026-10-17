// rule: async-defer-await
// verdict: fail
// weakness: type-value-binding
// source: synthetic
export const runView = async (execute) => {
  const sink = {};
  const paint = () => {
    const sink = {};
    interface sink {}
    sink.url = "/next";
  };
  const result = await execute({ paint });
  if (sink.url) return null;
  return result;
};
