// rule: query-no-mutation-in-effect-as-read
// weakness: name-heuristic
// source: deep review of millionco/react-doctor#1364

import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";

export const ListEditor = ({ payload }: { payload: unknown }) => {
  const { mutateAsync: updateList, data } = useMutation({ mutationFn: saveList });
  useEffect(() => {
    void updateList(payload);
  }, [payload, updateList]);
  return <output>{data?.items.length}</output>;
};
