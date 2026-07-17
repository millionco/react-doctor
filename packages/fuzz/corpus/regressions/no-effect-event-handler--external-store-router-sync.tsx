// rule: no-effect-event-handler
// weakness: library-idiom
// source: PR #1000 fuzz validation
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
