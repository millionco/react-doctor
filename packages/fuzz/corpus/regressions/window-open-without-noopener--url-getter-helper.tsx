// rule: window-open-without-noopener
// weakness: cross-file
// source: react-bench corpus audit 2026-07 (AppFlowy getViewUrl: sync get…Url route builder returns a same-origin path or null)
import { getViewUrl } from "./view-utils";

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
