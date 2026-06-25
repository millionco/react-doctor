import { createServer } from "node:net";

// True when a TCP server can bind the port on loopback. Used to detect that the
// well-known debug port is already held (by another app or a stale Chrome)
// before we launch our own instance onto it.
export const isPortAvailable = (port: number): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
