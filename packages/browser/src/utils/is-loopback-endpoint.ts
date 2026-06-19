export const isLoopbackEndpoint = (endpoint: string): boolean => {
  try {
    const { hostname } = new URL(endpoint);
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
};
