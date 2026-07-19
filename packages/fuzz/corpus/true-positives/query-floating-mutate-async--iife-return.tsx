// rule: query-floating-mutate-async
// weakness: control-flow
// source: deep review of millionco/react-doctor#1364

import { useMutation } from "@tanstack/react-query";

export const SaveButton = ({ payload }: { payload: unknown }) => {
  const mutation = useMutation({ mutationFn: savePayload });
  (() => mutation.mutateAsync(payload))();
  return null;
};
