// rule: mouse-events-have-key-events
// weakness: native-keyboard-parity
// source: synthetic regression
// verdict: pass

export const Action = ({ activate }) => (
  <button type="button" onClick={activate} onMouseOut={(event) => event.currentTarget.blur()}>
    Run
  </button>
);
