// rule: async-defer-await
// weakness: alias-guard
// source: independently authored public synthetic
// verdict: pass
export const runView = async (execute, consume, render) => {
  const sink = {};
  const paint = () => render(sink);
  const result = await execute({ paint });
  if (sink.url) return null;
  return result;
};
