// rule: query-floating-mutate-async
// weakness: callback-wrapper
// source: Cursor Bugbot review of millionco/react-doctor#1364

import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";

export const DraftSync = ({ draft, enabled }: { draft: Draft; enabled: boolean }) => {
  const mutation = useMutation({ mutationFn: saveDraft });
  const syncDraft = () => mutation.mutateAsync(draft);
  useEffect(enabled ? syncDraft : undefined, [draft, enabled]);
  return null;
};
