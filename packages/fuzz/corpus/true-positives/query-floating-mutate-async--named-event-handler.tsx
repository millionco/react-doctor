// rule: query-floating-mutate-async
// weakness: control-flow
// source: deep audit of millionco/react-doctor#1000

import { useMutation } from "@tanstack/react-query";

export const SaveButton = () => {
  const mutation = useMutation({ mutationFn: save });
  const handleClick = () => mutation.mutateAsync("draft");
  return <button onClick={handleClick}>Save</button>;
};
