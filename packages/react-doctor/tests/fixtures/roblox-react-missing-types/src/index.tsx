import React, { useMemo } from "@rbxts/react";

const App = () => {
  const labelText = useMemo(() => "Missing Roblox type markers", []);
  return <textlabel Text={labelText} />;
};

export default App;
