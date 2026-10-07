// rule: no-promise-then-side-effect-in-effect-without-catch
// verdict: pass
// weakness: control-flow, promise-assimilation
// source: Cursor Bugbot review on PR #1496
import { useEffect, useState } from "react";

export const Profile = ({ source }) => {
  const [, setProfile] = useState(null);

  useEffect(() => {
    fetch("/api/profile")
      .then(setProfile)
      .catch(() => {
        setProfile(source.fallback);
        return Promise.resolve(null);
      });
  }, [source]);

  return null;
};
