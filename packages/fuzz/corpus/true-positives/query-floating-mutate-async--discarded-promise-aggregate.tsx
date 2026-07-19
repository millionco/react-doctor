// rule: query-floating-mutate-async
// weakness: wrapper-transparency
// source: deep audit of millionco/react-doctor#1364

import { useMutation } from "@tanstack/react-query";

export const SaveAllButton = ({ drafts }: { drafts: Draft[] }) => {
  const mutation = useMutation({ mutationFn: saveDraft });
  return <button onClick={() => Promise.all([mutation.mutateAsync(drafts[0])])}>Save all</button>;
};
