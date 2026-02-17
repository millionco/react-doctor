import React, { useState } from "@rbxts/react";

const App = () => {
  const [count, setCount] = useState(0);
  const handleActivated = () => {
    setCount((previousCount) => previousCount + 1);
  };

  return <textbutton Text={`Count: ${count}`} Event={{ Activated: handleActivated }} />;
};

export default App;
