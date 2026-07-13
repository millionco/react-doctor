import { useEffect } from "react";

interface User {
  role: "user" | "admin";
}

declare const showLiveRole: (role: User["role"]) => void;

export const LiveSessionRole = ({ sessionKey, user }: { sessionKey: string; user: User }) => {
  useEffect(() => {
    showLiveRole(user.role);
  }, [sessionKey]);
  return null;
};
