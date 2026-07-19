// rule: query-floating-mutate-async
// weakness: callback-host
// source: Cursor Bugbot review of millionco/react-doctor#1364

import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";

export const SyncDraft = ({ draft, enabled }: { draft: Draft; enabled: boolean }) => {
  const mutation = useMutation({ mutationFn: saveDraft });
  useEffect(enabled ? () => mutation.mutateAsync(draft) : undefined, [draft, enabled, mutation]);
  return null;
};
