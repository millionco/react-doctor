import type { ChildProcess } from "node:child_process";
import * as net from "node:net";

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
export const setChildProcessRef = (child: ChildProcess, shouldRef: boolean): void => {
  if (shouldRef) {
    child.ref();
    child.channel?.ref();
  } else {
    child.unref();
    child.channel?.unref();
  }
  setStreamRef(child.stdout, shouldRef);
  setStreamRef(child.stderr, shouldRef);
};
