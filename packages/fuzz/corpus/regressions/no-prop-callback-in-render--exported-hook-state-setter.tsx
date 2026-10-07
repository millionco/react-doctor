// rule: no-prop-callback-in-render
// weakness: cross-file
// source: React Bench fix-react-viclafouch-mui-tel-input-usephonedigits-verified
interface SyncOptions {
  state: string;
  setState: (state: string) => void;
}

export const useSyncState = ({ state, setState }: SyncOptions) => {
  if (state === "stale") setState("fresh");
};
