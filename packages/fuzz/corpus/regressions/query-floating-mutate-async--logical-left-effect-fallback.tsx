// rule: query-floating-mutate-async
// weakness: callback-wrapper
// source: Cursor Bugbot review of millionco/react-doctor#1364

import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";

export const DraftSync = ({ draft }: { draft: Draft }) => {
  const mutation = useMutation({ mutationFn: saveDraft });
  const syncDraft = () => mutation.mutateAsync(draft);
  useEffect(syncDraft && startSubscription, [syncDraft]);
  return null;
};
