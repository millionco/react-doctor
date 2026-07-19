import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";

export const UserProfile = ({ userId }: { userId: string }) => {
  const { data, mutate: fetchUser, status } = useMutation({ mutationFn: fetchUserById });

  useEffect(() => {
    if ((status as string) === ("success" as const)) return;
    fetchUser(userId);
  }, [fetchUser, status, userId]);

  return <output>{data?.user.name}</output>;
};
