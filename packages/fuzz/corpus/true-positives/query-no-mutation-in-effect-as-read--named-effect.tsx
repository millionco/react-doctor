// rule: query-no-mutation-in-effect-as-read
// weakness: control-flow
// source: deep audit of millionco/react-doctor#1000

import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";

export const Profile = ({ userId }: { userId: string }) => {
  const { mutateAsync: fetchUser, data } = useMutation({ mutationFn: loadUser });
  const loadProfile = () => {
    void fetchUser(userId);
  };
  useEffect(loadProfile, [fetchUser, userId]);
  return <div>{data.user.name}</div>;
};
