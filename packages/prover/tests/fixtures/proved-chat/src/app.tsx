import { useEffect, useState } from "react";

interface ChatRoomProperties {
  roomId: string;
}

export const ChatRoom = ({ roomId }: ChatRoomProperties) => {
  const [connectionState, setConnectionState] = useState("online");

  useEffect(() => {
    const handleOnline = () => setConnectionState("online");
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  return (
    <p>
      {roomId}: {connectionState}
    </p>
  );
};
