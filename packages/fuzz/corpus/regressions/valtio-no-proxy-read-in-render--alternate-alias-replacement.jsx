// weakness: replacement-alias
// source: Cursor Bugbot review on PR #1396

import { useSnapshot } from "valtio";

export const Profile = ({ nextState, state }) => {
  const stateAlias = state;
  const snapshot = useSnapshot(state.profile);
  ({ profile: stateAlias.profile } = nextState);
  return <span>{state.profile.name + snapshot.name}</span>;
};
