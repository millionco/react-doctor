import { useState } from "react";
import type { ChangeEvent } from "react";

export const App = () => {
  const [name, setName] = useState<string | undefined>(undefined);
  return (
    <main>
      <button type="button" onClick={() => setName("Ada")}>
        Load profile
      </button>
      <input
        value={name}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.currentTarget.value)}
      />
    </main>
  );
};
