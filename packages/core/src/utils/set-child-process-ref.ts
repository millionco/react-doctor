import * as net from "node:net";

interface ChildProcessReference {
  readonly channel?: {
    readonly ref?: () => void;
    readonly unref?: () => void;
  } | null;
  readonly stdout?: unknown;
  readonly stderr?: unknown;
  readonly ref: () => void;
  readonly unref: () => void;
}

const setStreamRef = (stream: unknown, shouldRef: boolean): void => {
  if (!(stream instanceof net.Socket)) return;
  if (shouldRef) {
    stream.ref();
  } else {
    stream.unref();
  }
};

// A child that is unref'd on every handle (process, IPC channel, stdio) does
// not hold the host's event loop open; re-ref while it is doing work.
export const setChildProcessRef = (child: ChildProcessReference, shouldRef: boolean): void => {
  if (shouldRef) {
    child.ref();
    if (typeof child.channel?.ref === "function") child.channel.ref();
  } else {
    child.unref();
    if (typeof child.channel?.unref === "function") child.channel.unref();
  }
  setStreamRef(child.stdout, shouldRef);
  setStreamRef(child.stderr, shouldRef);
};
