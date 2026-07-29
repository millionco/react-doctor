// rule: no-promise-then-side-effect-in-effect-without-catch
// verdict: pass
// weakness: control-flow
// source: Cursor Bugbot review on PR #1496
import { useEffect, useState } from "react";

export const Profile = ({ source }) => {
  const [, setProfile] = useState(null);
  const fallback = null;

  useEffect(() => {
    fetch("/api/profile")
      .then(setProfile)
      .catch(() => {
        setProfile(source.fallback);
        return fallback;
      });
  }, [source]);

  return null;
};
