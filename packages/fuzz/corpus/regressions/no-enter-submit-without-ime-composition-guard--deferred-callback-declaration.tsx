// rule: no-enter-submit-without-ime-composition-guard
// weakness: control-flow
// source: deep audit of millionco/react-doctor#1000

export const Editor = () => (
  <input
    onKeyDown={(event) => {
      if (event.key === "Enter") {
        const commitLater = () => save();
        void commitLater;
      }
    }}
  />
);
