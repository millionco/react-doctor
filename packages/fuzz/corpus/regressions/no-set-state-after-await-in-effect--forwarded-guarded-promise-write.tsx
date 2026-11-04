// rule: no-set-state-after-await-in-effect
// weakness: forwarded-setter
// source: cancelled Promise continuation forwarded through a transparent setter helper
// verdict: pass
import { useEffect, useState } from "react";

const assign = <T,>(setter: (next: T) => void, next: T) => setter(next);

interface ProfileProps {
  userId: string;
}

export const Profile = ({ userId }: ProfileProps) => {
  const [name, setName] = useState("");

  useEffect(() => {
    let ignore = false;
    Promise.resolve(userId).then((nextName) => {
      if (ignore) return;
      assign(setName, nextName);
    });
    return () => {
      ignore = true;
    };
  }, [userId]);

  return <output>{name}</output>;
};
