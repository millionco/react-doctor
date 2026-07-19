// rule: query-floating-mutate-async
// weakness: control-flow
// source: Cursor Bugbot review of millionco/react-doctor#1364

import { useMutation } from "@tanstack/react-query";

export const SaveButton = ({ payload }: { payload: unknown }) => {
  const mutation = useMutation({ mutationFn: savePayload });
  const handleClick = () => (mutation.mutateAsync(payload), recordAttempt());
  return <button onClick={handleClick}>Save</button>;
};
