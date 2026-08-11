import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { readTextFileUpToCharacterLimit } from "../src/utils/read-text-file-up-to-character-limit.js";

const MAXIMUM_LENGTH_CHARS = 3;
const EXPECTED_ASCII_PROBE_LENGTH = 10;

let temporaryDirectory: string | null = null;

afterEach(async () => {
  if (temporaryDirectory !== null) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = null;
  }
});

const readLimitedText = async (sourceText: string): Promise<string> => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "react-doctor-source-limit-"));
  const filePath = path.join(temporaryDirectory, "source.tsx");
  await fs.writeFile(filePath, sourceText);
  return readTextFileUpToCharacterLimit({
    filePath,
    maximumLengthChars: MAXIMUM_LENGTH_CHARS,
    sizeBytes: Buffer.byteLength(sourceText),
  });
};

describe("readTextFileUpToCharacterLimit", () => {
  it("bounds an oversized ASCII read to the UTF-8 probe length", async () => {
    const sourceText = await readLimitedText("a".repeat(100));

    expect(sourceText).toHaveLength(EXPECTED_ASCII_PROBE_LENGTH);
  });

  it("retains multibyte text that fits the character limit", async () => {
    const sourceText = await readLimitedText("界".repeat(MAXIMUM_LENGTH_CHARS));

    expect(sourceText).toBe("界".repeat(MAXIMUM_LENGTH_CHARS));
  });
});
