// rule: async-defer-await
// weakness: alias-guard
// source: independently authored public synthetic
// verdict: fail
export const runView = async (execute, consume, render) => {
  const sink = {};
  const other = {};
  const paint = () => render(other);
  const result = await execute({ paint });
  if (sink.url) return null;
  return result;
};
