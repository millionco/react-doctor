// rule: no-render-in-render
// weakness: control-flow
// source: ISSUES_TO_FIX_ASAP.md 2026-07-12 unreachable nested hook

const Panel = () => {
  const renderPanel = () => {
    const useUnusedState = () => useState(0);
    void useUnusedState;
    return <div>stable</div>;
  };

  return <section>{renderPanel()}</section>;
};

void Panel;
