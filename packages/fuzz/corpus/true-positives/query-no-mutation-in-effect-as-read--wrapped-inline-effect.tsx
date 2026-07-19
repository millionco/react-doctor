// rule: query-no-mutation-in-effect-as-read
// weakness: callback-host
// source: Cursor Bugbot review of millionco/react-doctor#1364

import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";

export const UserPreview = ({ userId, enabled }: { userId: string; enabled: boolean }) => {
  const getUser = useMutation({ mutationFn: fetchUser });
  useEffect(enabled ? () => getUser.mutate(userId) : undefined, [enabled, getUser, userId]);
  return <output>{getUser.data?.name}</output>;
};
