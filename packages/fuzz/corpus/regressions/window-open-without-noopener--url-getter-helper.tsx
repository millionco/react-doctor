// rule: window-open-without-noopener
// weakness: cross-file
// source: react-bench corpus audit 2026-07 (a locally proven URL getter returns a same-origin path)
const getViewUrl = (view: { view_id: string }, currentWorkspaceId: string) =>
  `/workspace/${currentWorkspaceId}/view/${view.view_id}`;

export const OpenInNewTab = ({
  view,
  currentWorkspaceId,
}: {
  view: { view_id: string };
  currentWorkspaceId: string;
}) => {
  const onSelect = () => {
    const url = getViewUrl(view, currentWorkspaceId);
    if (!url) return;
    window.open(url, "_blank");
  };
  return (
    <button type="button" onClick={onSelect}>
      Open in new tab
    </button>
  );
};
