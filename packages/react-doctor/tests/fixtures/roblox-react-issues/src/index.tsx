import React, { useEffect, useRef, useState } from "@rbxts/react";

// Rule 1: rbx-no-uncleaned-connection
// .Connect() in useEffect without cleanup
const UncleanedConnectionComponent = () => {
  useEffect(() => {
    const event = { Connect: (_callback: () => void) => ({ Disconnect: () => {} }) };
    event.Connect(() => {
      print("event fired");
    });
  }, []);

  return <textlabel Text="No cleanup" />;
};

// Rule 2: rbx-no-print
// print() and warn() calls left in code
const PrintComponent = () => {
  const handleClick = () => {
    print("Button clicked");
    warn("This is a warning");
  };

  return <textbutton Text="Click" Event={{ Activated: handleClick }} />;
};

// Rule 3: rbx-no-direct-instance-mutation
// Direct mutation of ref.current properties
const DirectMutationComponent = () => {
  const ref = useRef<TextLabel>();

  useEffect(() => {
    if (ref.current) {
      ref.current.BackgroundColor3 = new Color3(1, 0, 0);
      ref.current.TextColor3 = new Color3(1, 1, 1);
    }
  }, []);

  return <textlabel ref={ref} Text="Mutated" />;
};

// Rule 4: rbx-no-unstored-connection
// .Connect() result not stored (outside useEffect)
const UnstoredConnectionComponent = () => {
  const event = { Connect: (_callback: () => void) => ({ Disconnect: () => {} }) };
  
  event.Connect(() => {
    print("outside effect");
  });

  return <textlabel Text="Not stored" />;
};

export {
  UncleanedConnectionComponent,
  PrintComponent,
  DirectMutationComponent,
  UnstoredConnectionComponent,
};
