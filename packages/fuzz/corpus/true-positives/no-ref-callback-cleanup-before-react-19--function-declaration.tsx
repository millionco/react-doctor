// rule: no-ref-callback-cleanup-before-react-19
// weakness: local-function-resolution
// source: PR #1356 Bugbot review

const attach = (element: HTMLDivElement | null): void => {
  element?.setAttribute("data-attached", "true");
};

export const FunctionDeclarationRef = () => {
  function attachWithCleanup(element: HTMLDivElement | null) {
    attach(element);
    return () => {
      element?.removeAttribute("data-attached");
    };
  }

  return <div ref={attachWithCleanup} />;
};
