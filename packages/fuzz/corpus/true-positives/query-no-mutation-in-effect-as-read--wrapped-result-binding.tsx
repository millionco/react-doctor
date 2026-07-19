import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";

interface MutationResult {
  data?: { user: { name: string } };
  mutate: (userId: string) => void;
}

export const UserProfile = ({ userId }: { userId: string }) => {
  const fetchUserMutation = useMutation({ mutationFn: fetchUser });
  const requestUser = fetchUserMutation!.mutate as MutationResult["mutate"];

  useEffect(() => {
    (requestUser as MutationResult["mutate"])(userId);
  }, [requestUser, userId]);

  return <div>{(fetchUserMutation as MutationResult).data?.user.name}</div>;
};
