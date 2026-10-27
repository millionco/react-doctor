import { StreamChat } from "stream-chat";
import { Chat } from "stream-chat-react";
import { Workspace } from "./workspace";

const connection = StreamChat.getInstance("synthetic-project-key");

export const Application = () => (
  <Chat client={connection}>
    <Workspace />
  </Chat>
);
