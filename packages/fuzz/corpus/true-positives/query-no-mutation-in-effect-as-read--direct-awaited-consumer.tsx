// rule: query-no-mutation-in-effect-as-read
// weakness: result consumption
// source: Cursor Bugbot review of millionco/react-doctor#1364

import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";

export const Profile = ({ userId }: { userId: string }) => {
  const { mutateAsync: fetchUser } = useMutation({ mutationFn: loadUser });
  useEffect(() => {
    void (async () => setUser((await fetchUser(userId)).user))();
  }, [fetchUser, userId]);
  return null;
};
