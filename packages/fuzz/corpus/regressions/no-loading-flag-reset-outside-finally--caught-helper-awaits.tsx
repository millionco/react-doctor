// rule: no-loading-flag-reset-outside-finally
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (taste tab: every await inside the same-file helper carries an inline .catch, so it never rejects)
import { useCallback, useState } from "react";
import { api } from "./api";
import { toast } from "./toast";

export const TasteTab = ({ answer }: { answer: string }) => {
  const [profile, setProfile] = useState<object | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const loadProfile = useCallback(async () => {
    const data = await api.getTasteProfile().catch(() => null);
    if (data) setProfile(data);
    setLoading(false);
  }, []);
  const submitAnswer = async () => {
    setSubmitting(true);
    const result = await api.submitTasteAnswer(answer).catch(() => null);
    if (!result) {
      toast.error("Failed to save response");
      setSubmitting(false);
      return;
    }
    await loadProfile();
    setSubmitting(false);
  };
  return (
    <button type="button" disabled={loading || submitting} onClick={submitAnswer}>
      {profile ? "Update answer" : "Submit answer"}
    </button>
  );
};
