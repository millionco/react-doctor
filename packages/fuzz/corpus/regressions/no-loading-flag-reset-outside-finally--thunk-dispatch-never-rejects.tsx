// rule: no-loading-flag-reset-outside-finally
// weakness: library-idiom
// source: react-bench corpus audit 2026-07 (internxt: dispatching an RTK createAsyncThunk never rejects — failures resolve to a rejected action)
import { useState } from "react";
import { useDispatch } from "react-redux";
import { sharedThunks } from "./shared-links-slice";

export const StopSharingDialog = ({ itemId, onClose }: { itemId: string; onClose: () => void }) => {
  const dispatch = useDispatch();
  const [isLoading, setIsLoading] = useState(false);
  const onStopSharing = async () => {
    setIsLoading(true);
    await dispatch(sharedThunks.stopSharingItem({ itemId }));
    onClose();
    setIsLoading(false);
  };
  return (
    <button type="button" disabled={isLoading} onClick={onStopSharing}>
      Stop sharing
    </button>
  );
};
