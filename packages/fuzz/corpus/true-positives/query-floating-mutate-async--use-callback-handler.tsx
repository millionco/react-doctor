// rule: query-floating-mutate-async
// weakness: provenance
// source: Cursor Bugbot review of millionco/react-doctor#1364

import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";

export const SaveButton = () => {
  const mutation = useMutation({ mutationFn: save });
  const handleClick = useCallback(() => mutation.mutateAsync("draft"), [mutation]);
  return <button onClick={handleClick}>Save</button>;
};
