// rule: query-floating-mutate-async
// weakness: callback-host
// source: Cursor Bugbot review of millionco/react-doctor#1364

import { useMutation } from "@tanstack/react-query";

export const SyncDraft = ({ draft, enabled }: { draft: Draft; enabled: boolean }) => {
  const mutation = useMutation({ mutationFn: saveDraft });
  const synchronize = () => mutation.mutateAsync(draft);
  queueMicrotask(enabled ? synchronize : reportDisabled);
  return null;
};
