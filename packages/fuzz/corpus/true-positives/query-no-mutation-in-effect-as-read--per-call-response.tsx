// rule: query-no-mutation-in-effect-as-read
// weakness: callback-consumer
// source: deep audit of millionco/react-doctor#1364

import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";

export const UserPreview = ({ userId }: { userId: string }) => {
  const getUser = useMutation({ mutationFn: fetchUser });
  useEffect(() => {
    getUser.mutate(userId, { onSuccess: (user) => showUser(user) });
  }, [getUser, userId]);
  return null;
};
