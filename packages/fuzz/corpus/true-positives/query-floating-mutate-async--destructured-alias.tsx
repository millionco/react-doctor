// rule: query-floating-mutate-async
// weakness: alias-guard
// source: deep review of millionco/react-doctor#1364

import { useMutation } from "@tanstack/react-query";

export const SaveButton = ({ payload }: { payload: unknown }) => {
  const { mutateAsync } = useMutation({ mutationFn: savePayload });
  const save = mutateAsync;
  save(payload);
  return null;
};
