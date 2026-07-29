import { useState } from "react";

export const App = () => {
  const [name] = useState("Ada");
  return <input value={name} />;
};
