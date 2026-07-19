// rule: query-floating-mutate-async
// weakness: interprocedural return flow
// source: Cursor Bugbot review of millionco/react-doctor#1364

import { useMutation } from "@tanstack/react-query";

export const SaveButton = ({ payload }: { payload: unknown }) => {
  const mutation = useMutation({ mutationFn: savePayload });
  const requestSave = () => mutation.mutateAsync(payload);
  const handleClick = () => requestSave();
  return <button onClick={handleClick}>Save</button>;
};
