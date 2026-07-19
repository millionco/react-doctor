// rule: query-no-mutation-in-effect-as-read
// weakness: name-heuristic
// source: React Bench audit of millionco/react-doctor#1000

import { useEffect, useState } from "react";

const useCreateClaim = () => ({
  mutateAsync: async () => ({ claim: { id: "created-claim" } }),
});

export const ClaimCreationRoute = () => {
  const [claimId, setClaimId] = useState<string>();
  const { mutateAsync: createClaim } = useCreateClaim();

  useEffect(() => {
    const run = async () => {
      const { claim } = await createClaim();
      setClaimId(claim.id);
    };
    void run();
  }, [createClaim]);

  return <div>{claimId}</div>;
};
