// rule: query-no-mutation-in-effect-as-read
// weakness: name-heuristic
// source: deep audit of millionco/react-doctor#1364

import { useMutation } from "@tanstack/react-query";

const useEffect = (callback: () => void) => callback();

export const UserPreview = ({ userId }: { userId: string }) => {
  const getUser = useMutation({ mutationFn: fetchUser });
  useEffect(() => getUser.mutate(userId));
  return <output>{getUser.data?.name}</output>;
};
