import { useState } from "react";
import type { ChangeEvent } from "react";

export const App = () => {
  const [name, setName] = useState("Ada");
  return (
    <input
      value={name}
      defaultValue="Grace"
      onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.currentTarget.value)}
    />
  );
};
