import { useState } from "react";
import type { ChangeEvent } from "react";

export const App = () => {
  const [name, setName] = useState("");
  return (
    <input
      value={name}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        setTimeout(() => setName(event.currentTarget.value));
      }}
    />
  );
};
