// rule: query-no-mutation-in-effect-as-read
// weakness: control-flow
// source: Cursor Bugbot review of millionco/react-doctor#1364

import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";

export const ProfileRefresh = ({ userId }: { userId: string }) => {
  const { mutateAsync: fetchUser } = useMutation({ mutationFn: loadUser });
  useEffect(() => {
    void (async () => {
      void (await fetchUser(userId));
    })();
  }, [fetchUser, userId]);
  return null;
};
