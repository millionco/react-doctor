// rule: query-floating-mutate-async
// weakness: library-idiom
// source: deep audit of millionco/react-doctor#1364

import { useMutation } from "@tanstack/react-query";

const useEffect = (callback: () => Promise<unknown>) => callback().catch(reportError);

export const SyncDraft = ({ draft }: { draft: Draft }) => {
  const mutation = useMutation({ mutationFn: saveDraft });
  const syncDraft = () => mutation.mutateAsync(draft);
  useEffect(syncDraft);
  return null;
};
