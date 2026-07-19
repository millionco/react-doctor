// rule: query-no-mutation-in-effect-as-read
// weakness: nullish-guard
// source: Cursor Bugbot review of millionco/react-doctor#1364

import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";

export const UserProfile = ({ userId }: { userId: string }) => {
  const { mutate: fetchUser, data } = useMutation({ mutationFn: loadUser });
  useEffect(() => {
    if (data !== void 0) return;
    fetchUser(userId);
  }, [data, fetchUser, userId]);
  return <output>{data?.name}</output>;
};
