import React, { useState, useEffect } from "@rbxts/react";

const App = () => {
  const [count, setCount] = useState(0);
  const handleActivated = () => {
    setCount((previousCount) => previousCount + 1);
  };

  return <textbutton Text={`Count: ${count}`} Event={{ Activated: handleActivated }} />;
};

// Valid: .Destroy() cleans up all instance connections
const ProximityPromptComponent = () => {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const prompt = { 
      PromptShown: { Connect: (_callback: () => void) => ({}) },
      PromptHidden: { Connect: (_callback: () => void) => ({}) },
      Destroy: () => {}
    };
    
    prompt.PromptShown.Connect(() => {
      setShown(true);
    });
    
    prompt.PromptHidden.Connect(() => {
      setShown(false);
    });

    return () => {
      prompt.Destroy();
    };
  }, []);

  return <textlabel Text={shown ? "Shown" : "Hidden"} />;
};

export default App;
export { ProximityPromptComponent };
