import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";

export const StatusGuardProfile = ({ userId }: { userId: string }) => {
  const { data, mutate: fetchUser, status } = useMutation({ mutationFn: fetchUserById });

  useEffect(() => {
    if (!(status !== "success")) return;
    fetchUser(userId);
  }, [fetchUser, status, userId]);

  return <output>{data?.user.name}</output>;
};

export const DataGuardProfile = ({ userId }: { userId: string }) => {
  const { data, mutate: fetchUser } = useMutation({ mutationFn: fetchUserById });

  useEffect(() => {
    if (!(data !== undefined)) {
      fetchUser(userId);
    }
  }, [data, fetchUser, userId]);

  return <output>{data?.user.name}</output>;
};
