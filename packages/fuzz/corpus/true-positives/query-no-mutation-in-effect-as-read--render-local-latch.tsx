// rule: query-no-mutation-in-effect-as-read
// weakness: provenance
// source: Cursor Bugbot review of millionco/react-doctor#1364

import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";

export const Profile = ({ userId }: { userId: string }) => {
  const { mutateAsync: fetchUser } = useMutation({ mutationFn: loadUser });
  const handled = { current: false };
  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    void fetchUser(userId).then((response) => setUser(response.user));
  }, [fetchUser, userId]);
  return null;
};
