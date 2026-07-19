// rule: window-open-without-noopener
// weakness: custom-callback-return
import * as React from "react";

interface ConsumerProps {
  onClick: () => Window | null;
}

const Consumer = ({ onClick }: ConsumerProps) => onClick();

export const App = (userControlledUrl: string) => (
  <Consumer onClick={() => window.open(userControlledUrl)} />
);

export const CreateElementApp = (userControlledUrl: string) =>
  React.createElement(Consumer, {
    onClick: () => window.open(userControlledUrl),
  });
