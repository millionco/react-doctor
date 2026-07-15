// rule: no-initialize-state
// weakness: control-flow
// source: paired control for async gating wrapper regression

import { useEffect, useState } from "react";

interface ProfileProps {
  initialName: string;
}

export const Profile = ({ initialName }: ProfileProps) => {
  const [name, setName] = useState("");
  const initializeName = () => {
    setName(initialName);
  };

  useEffect(() => {
    initializeName();
  }, []);

  return <span>{name}</span>;
};
