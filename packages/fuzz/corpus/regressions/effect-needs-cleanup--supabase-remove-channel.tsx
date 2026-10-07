// verdict: pass
// rule: effect-needs-cleanup
// weakness: alias-guard
// source: GitHub issue 1539
import { useEffect } from "react";

interface RealtimeChannel {
  on: (...arguments_: unknown[]) => RealtimeChannel;
  subscribe: () => RealtimeChannel;
}

interface RealtimeMessagesProps {
  onInsert: () => void;
  roomId: string;
  supabase: {
    channel: (topic: string) => RealtimeChannel;
    removeChannel: (channel: unknown) => void;
  };
}

export const RealtimeMessages = ({ onInsert, roomId, supabase }: RealtimeMessagesProps) => {
  useEffect(() => {
    const channel = supabase
      .channel(`messages:${roomId}`)
      .on("postgres_changes", { event: "INSERT" }, onInsert)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [onInsert, roomId, supabase]);

  return null;
};
