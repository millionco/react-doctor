import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export const hashFileSha256 = async (filePath: string): Promise<string> => {
  const hasher = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hasher.update(chunk);
  return hasher.digest("hex");
};
