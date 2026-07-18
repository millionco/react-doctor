// rule: query-floating-mutate-async
// weakness: wrapper-transparency
// source: Cursor Bugbot review of millionco/react-doctor#1364

import { useMutation } from "@tanstack/react-query";

export const SaveButton = ({ draft }: { draft: Draft }) => {
  const mutation = useMutation({ mutationFn: saveDraft });
  const request = mutation.mutateAsync(draft) ?? Promise.resolve();
  return <button onClick={() => request.catch(reportError)}>Save</button>;
};
