import { useState } from "react";

export const AccountForm = () => {
  const [status, setStatus] = useState("active");
  const deactivateAction = () => setStatus("inactive");

  return (
    <form>
      <button type="submit" formAction={deactivateAction}>
        Deactivate
      </button>
      <output>{status}</output>
    </form>
  );
};
