import { useState } from "react";

interface ProfileProperties {
  disabled: boolean;
}

export const Profile = ({ disabled }: ProfileProperties) => {
  if (disabled) return null;
  const [name] = useState("Ada");
  return <p>{name}</p>;
};
