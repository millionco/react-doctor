import { useEffect } from "react";
import { useDirectoryStore } from "./store";

interface DirectoryProviderProps {
  directory: string;
  draftId?: string;
}

export const DirectoryProvider = (props: DirectoryProviderProps) => {
  const navigate = useNavigate();
  const store = useDirectoryStore();
  const snapshot = store();
  const nextDirectory = snapshot.path.directory;

  useEffect(() => {
    if (props.draftId) return;
    const next = nextDirectory;
    if (!next || next === props.directory) return;
    navigate(encodeDirectory(next), { replace: true });
  }, [props.draftId, props.directory, nextDirectory, navigate]);

  return null;
};

export const NotificationRelay = (props: { didSubmit: boolean }) => {
  useEffect(() => {
    if (props.didSubmit) toast("Submitted");
  }, [props.didSubmit]);

  return null;
};
