// rule: query-floating-mutate-async
// weakness: callback-host
// source: Cursor Bugbot review of millionco/react-doctor#1364

import { useMutation } from "@tanstack/react-query";

export const SaveAllButton = ({ drafts }: { drafts: Draft[] }) => {
  const mutation = useMutation({ mutationFn: saveDraft });
  return (
    <button onClick={() => void drafts.map((draft) => mutation.mutateAsync(draft))}>Save</button>
  );
};
