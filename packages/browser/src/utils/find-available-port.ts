import { createServer, type AddressInfo } from "node:net";

// Ask the OS for an unused loopback port (bind to port 0, read what it assigned).
// There is an inherent race between releasing it here and Chrome claiming it, but
// it is far less likely to collide than reusing a port we already know is taken.
export const findAvailablePort = (): Promise<number> =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.once("listening", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
    server.listen(0, "127.0.0.1");
  });
