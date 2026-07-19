// rule: query-no-mutation-in-effect-as-read
// weakness: alias-guard
// source: Cursor Bugbot review of millionco/react-doctor#1364

import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";

export const UserProfile = ({ userId }: { userId: string }) => {
  const { mutate: fetchUser, data, isSuccess } = useMutation({ mutationFn: loadUser });
  const didLoadUser = isSuccess;
  useEffect(() => {
    if (didLoadUser) return;
    fetchUser(userId);
  }, [didLoadUser, fetchUser, userId]);
  return <output>{data?.name}</output>;
};
