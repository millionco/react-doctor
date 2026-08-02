// rule: no-effect-chain
// verdict: pass
// weakness: control-flow
// source: parity sanity-io/sanity LiveQueries.tsx

import { useEffect, useState } from "react";

interface Channel {
  on: (eventName: string, callback: () => void) => void;
  post: (eventName: string, value: string) => void;
  start: () => () => void;
}

interface ChannelController {
  createChannel: () => Channel;
}

interface StoredChannelLifecycleProps {
  controller: ChannelController | null;
  perspective: string;
}

export const StoredChannelLifecycle = ({
  controller,
  perspective,
}: StoredChannelLifecycleProps) => {
  const [channel, setChannel] = useState<Channel>();

  useEffect((): (() => void) => {
    if (controller) {
      const nextChannel = controller.createChannel();
      setChannel(nextChannel);
      nextChannel.on("message", () => undefined);
      return nextChannel.start();
    }
    return () => undefined;
  }, [controller]);

  useEffect(() => {
    if (channel) channel.post("perspective", perspective);
  }, [channel, perspective]);

  return null;
};
