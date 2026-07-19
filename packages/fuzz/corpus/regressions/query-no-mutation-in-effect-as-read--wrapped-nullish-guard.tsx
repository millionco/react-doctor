// rule: query-no-mutation-in-effect-as-read
// weakness: wrapper-transparency
// source: Cursor Bugbot review of millionco/react-doctor#1364

import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";

export const UserPreview = ({ userId }: { userId: string }) => {
  const getUser = useMutation({ mutationFn: fetchUser });
  useEffect(() => {
    if (getUser.data !== (undefined as unknown)) return;
    getUser.mutate(userId);
  }, [getUser, userId]);
  return <output>{getUser.data?.name}</output>;
};
