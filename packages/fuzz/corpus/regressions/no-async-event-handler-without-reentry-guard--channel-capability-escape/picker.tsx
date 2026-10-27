import { useEffect, useState } from "react";
import { useChatContext } from "stream-chat-react";

const Choice = ({ channel, activate }) => (
  <button type="button" onClick={() => activate(channel)}>
    {channel.id}
  </button>
);

export const Picker = () => {
  const { client, setActiveChannel } = useChatContext();
  const [channels, setChannels] = useState([]);
  useEffect(() => {
    const load = async () => {
      const request = client.queryChannels({});
      const [available] = await Promise.all([request]);
      setChannels(available);
    };
    load();
  }, [client]);
  return (
    <div>
      {channels.map((channel) => (
        <Choice key={channel.id} channel={channel} activate={setActiveChannel} />
      ))}
    </div>
  );
};
