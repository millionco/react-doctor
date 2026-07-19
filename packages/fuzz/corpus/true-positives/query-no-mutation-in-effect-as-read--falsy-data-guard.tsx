// rule: query-no-mutation-in-effect-as-read
// weakness: control-flow
// source: deep review of millionco/react-doctor#1364

import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";

export const Counter = ({ scope }: { scope: string }) => {
  const { mutateAsync: fetchCount, data } = useMutation({ mutationFn: loadCount });
  useEffect(() => {
    if (data) return;
    void fetchCount(scope).then((response) => setCount(response.count));
  }, [data, fetchCount, scope]);
  return <output>{data}</output>;
};
