// rule: query-no-mutation-in-effect-as-read
// weakness: provenance
// source: Cursor Bugbot review of millionco/react-doctor#1364

import { useCallback, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";

export const Profile = ({ userId }: { userId: string }) => {
  const { mutateAsync: fetchUser, data } = useMutation({ mutationFn: loadUser });
  const loadProfile = useCallback(() => {
    void fetchUser(userId);
  }, [fetchUser, userId]);
  useEffect(loadProfile, [loadProfile]);
  return <div>{data.user.name}</div>;
};
