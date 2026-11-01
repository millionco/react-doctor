// rule: no-promise-then-side-effect-in-effect-without-catch
// weakness: cross-file
// source: SDK promise role regression
// verdict: fail
import { useEffect, useState } from "react";
import { UserManager, WebStorageStateStore } from "oidc-client";
const settings = { userStore: new WebStorageStateStore({ store: window.localStorage }) };
const manager = new UserManager(settings);
export const AccountPanel = () => {
  const [user, setUser] = useState(null);
  useEffect(() => {
    manager.getUser().then(setUser);
  }, []);
  return <output>{user?.name}</output>;
};
