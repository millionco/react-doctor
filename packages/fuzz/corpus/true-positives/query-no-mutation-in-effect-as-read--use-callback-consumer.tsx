// rule: query-no-mutation-in-effect-as-read
// weakness: callback wrapper provenance
// source: Cursor Bugbot review of millionco/react-doctor#1364

import { useCallback, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";

export const Profile = ({ userId }: { userId: string }) => {
  const { mutateAsync: fetchUser } = useMutation({ mutationFn: loadUser });
  const handleResponse = useCallback((response) => setUser(response.user), []);
  useEffect(() => {
    void fetchUser(userId).then(handleResponse);
  }, [fetchUser, handleResponse, userId]);
  return null;
};
