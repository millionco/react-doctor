// rule: query-no-mutation-in-effect-as-read
// weakness: control-flow
// source: deep review of millionco/react-doctor#1364

import { useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";

export const Profile = ({ userId }: { userId: string }) => {
  const handled = useRef(false);
  const { mutateAsync: fetchUser } = useMutation({ mutationFn: loadUser });
  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    void fetchUser(userId).then((response) => setUser(response.user));
    return () => {
      handled.current = false;
    };
  }, [fetchUser, userId]);
  return null;
};
