import { useState } from "react";
import type { ChangeEvent } from "react";

export const App = () => {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [subscribed, setSubscribed] = useState(false);
  const [region, setRegion] = useState("north");
  return (
    <form>
      <input
        value={name}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.currentTarget.value)}
      />
      <textarea
        value={notes}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setNotes(event.currentTarget.value)}
      />
      <input
        type="checkbox"
        checked={subscribed}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          setSubscribed(event.currentTarget.checked)
        }
      />
      <select
        value={region}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => setRegion(event.currentTarget.value)}
      >
        <option value="north">North</option>
        <option value="south">South</option>
      </select>
    </form>
  );
};
