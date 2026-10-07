// rule: react-router-guard-aborted-handle-error
// weakness: nested-function-control-flow
// source: adversarial contract audit of PR #1411
export const handleError = (error: Error, { request }: { request: Request }) => {
  const reportLater = () => console.error(error);
  if (request.signal.aborted) return;
  void reportLater;
};
