// rule: no-enter-submit-without-ime-composition-guard
// weakness: control-flow
// source: deep audit of millionco/react-doctor#1000

export const Editor = () => (
  <input
    onKeyDown={() => {
      const handleLater = (event: KeyboardEvent) => {
        if (event.key === "Enter") save();
      };
      void handleLater;
    }}
  />
);
