// rule: exhaustive-deps
// weakness: effect-semantics
// source: react-bench glific/glific-frontend oracle validation
import { useEffect, useState } from "react";

export const ExtensionForm = ({ openDialog }) => {
  const [name, setName] = useState("ready");
  const [isActive, setIsActive] = useState(true);
  useEffect(() => {
    if (!openDialog) {
      setName("");
      setIsActive(false);
    }
  });
  return <output>{name + String(isActive)}</output>;
};
