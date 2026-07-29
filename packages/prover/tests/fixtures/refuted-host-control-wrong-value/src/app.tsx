import { useState } from "react";
import type { ChangeEvent } from "react";

export const App = () => {
  const [name, setName] = useState("");
  return (
    <input
      value={name}
      onChange={(event: ChangeEvent<HTMLInputElement>) =>
        setName(event.currentTarget.value.toUpperCase())
      }
    />
  );
};
