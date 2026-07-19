import { useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";

export const UserProfile = ({ userId }: { userId: string }) => {
  const handled = useRef(false);
  const { mutateAsync: fetchUser } = useMutation({ mutationFn: fetchUserById });

  useEffect(() => {
    if (!(handled.current as boolean)) {
      handled.current = true;
      void fetchUser(userId).then((response) => renderUser(response.user));
    }
  }, [fetchUser, userId]);

  return null;
};
