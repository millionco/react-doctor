// rule: query-no-mutation-in-effect-as-read
// weakness: alias-guard
// source: deep audit of millionco/react-doctor#1364

import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";

export const UserPreview = ({ userId }: { userId: string }) => {
  const getUser = useMutation({ mutationFn: fetchUser });
  const { mutate } = getUser;
  useEffect(() => mutate(userId), [mutate, userId]);
  return <output>{getUser.data?.name}</output>;
};
