// rule: rendering-hydration-no-flicker
// weakness: control-flow
// source: 0.8.1-to-main all-rules parity audit
// verdict: pass

import { useEffect, useState } from "react";

export const UserDetails = ({ userDetails }) => {
  const [user, setUser] = useState([]);

  useEffect(() => {
    setUser(userDetails);
  }, []);

  return <div>User details</div>;
};
