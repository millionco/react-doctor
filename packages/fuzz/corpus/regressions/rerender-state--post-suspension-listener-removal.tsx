// rule: rerender-state-only-in-handlers
// weakness: post-suspension-listener-removal
// source: Bugbot review of PR 1311
import { useEffect, useState } from "react";

export const PostSuspensionListenerRemoval = () => {
  const [_revision, setRevision] = useState(0);
  const onPopState = () => setRevision((previous) => previous + 1);
  const unregister = () => window.removeEventListener("popstate", onPopState);
  const registerTemporarily = async () => {
    window.addEventListener("popstate", onPopState);
    await Promise.resolve();
    unregister();
  };

  useEffect(() => {
    void registerTemporarily();
  }, []);

  return <output>{location.pathname}</output>;
};
