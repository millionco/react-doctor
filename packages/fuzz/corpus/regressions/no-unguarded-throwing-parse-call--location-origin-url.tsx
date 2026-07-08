// rule: no-unguarded-throwing-parse-call
// weakness: control-flow
// source: PR #1000 corpus sweep (artsy: origin-pinned template cannot make new URL throw)
export const Sidebar = ({ match }: { match: { params: { conversationId: string } } }) => {
  const url = new URL(
    `${window.location.origin}/user/conversations/${match.params.conversationId}`,
  );
  return <a href={url.href}>Open</a>;
};
