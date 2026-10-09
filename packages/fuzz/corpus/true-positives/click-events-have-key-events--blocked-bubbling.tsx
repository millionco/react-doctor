// rule: click-events-have-key-events
// verdict: fail
export const ClickablePanel = ({ open }) => (
  <div onClick={open}>
    <div onClick={(event) => event.stopPropagation()}>
      <button>Select</button>
    </div>
  </div>
);
