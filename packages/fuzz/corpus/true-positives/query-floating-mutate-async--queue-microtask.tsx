// rule: query-floating-mutate-async
// weakness: callback-host
// source: Cursor Bugbot review of millionco/react-doctor#1364

import { useMutation } from "@tanstack/react-query";

export const DraftSync = ({ draft }: { draft: Draft }) => {
  const mutation = useMutation({ mutationFn: saveDraft });
  const syncDraft = () => mutation.mutateAsync(draft);
  queueMicrotask(syncDraft);
  return null;
};
