// rule: query-no-mutation-in-effect-as-read
// weakness: alias-guard
// source: deep review of millionco/react-doctor#1364

import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";

export const Profile = ({ enabled, userId }: { enabled: boolean; userId: string }) => {
  const fetchUserMutation = useMutation({ mutationFn: loadUser });
  const aliasedMutation = fetchUserMutation;
  const loadUserFromMutation = () => aliasedMutation.mutate(userId);
  const aliasedLoader = loadUserFromMutation;
  useEffect(enabled ? aliasedLoader : undefined, [aliasedLoader, enabled]);
  return <output>{aliasedMutation.data?.user.name}</output>;
};
