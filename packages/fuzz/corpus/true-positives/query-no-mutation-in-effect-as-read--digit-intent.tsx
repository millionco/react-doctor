// rule: query-no-mutation-in-effect-as-read
// weakness: identifier tokenization
// source: Cursor Bugbot review of millionco/react-doctor#1364

import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";

export const SecuritySettings = ({ userId }: { userId: string }) => {
  const { mutateAsync: get2FA } = useMutation({ mutationFn: loadChallenge });
  useEffect(() => {
    void get2FA(userId).then((response) => setChallenge(response.challenge));
  }, [get2FA, userId]);
  return null;
};
