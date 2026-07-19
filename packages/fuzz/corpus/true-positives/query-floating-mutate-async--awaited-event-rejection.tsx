// rule: query-floating-mutate-async
// weakness: callback-host
// source: deep audit of millionco/react-doctor#1364

import { useMutation } from "@tanstack/react-query";

export const SaveButton = ({ draft }: { draft: Draft }) => {
  const mutation = useMutation({ mutationFn: saveDraft });
  return (
    <button
      onClick={async () => {
        await mutation.mutateAsync(draft);
      }}
    >
      Save
    </button>
  );
};
