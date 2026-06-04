import os from "node:os";
import { describe, expect, it } from "vite-plus/test";
import { scrubSensitivePaths } from "../src/cli/utils/scrub-sensitive-text.js";

describe("scrubSensitivePaths", () => {
  it("replaces the current user's home directory with ~", () => {
    const homeDirectory = os.homedir();
    const scrubbed = scrubSensitivePaths(`${homeDirectory}/dev/project/src/index.ts`);
    expect(scrubbed).toBe("~/dev/project/src/index.ts");
    expect(scrubbed).not.toContain(homeDirectory);
  });

  it("anonymizes macOS user-home paths for any username", () => {
    expect(scrubSensitivePaths("/Users/jane.doe/code/app")).toBe("~/code/app");
    expect(scrubSensitivePaths("at /Users/john/work/a.ts:1:2")).toBe("at ~/work/a.ts:1:2");
  });

  it("anonymizes Linux user-home paths", () => {
    expect(scrubSensitivePaths("/home/deploy/srv/app")).toBe("~/srv/app");
  });

  it("anonymizes Windows user-home paths with either slash", () => {
    expect(scrubSensitivePaths("C:\\Users\\Alice\\app\\index.js")).toBe("~\\app\\index.js");
    expect(scrubSensitivePaths("C:/Users/Alice/app/index.js")).toBe("~/app/index.js");
  });

  it("strips the username from multiple occurrences in one string", () => {
    expect(scrubSensitivePaths("/Users/bob/a and /Users/bob/b")).toBe("~/a and ~/b");
  });

  it("leaves text without home paths untouched", () => {
    expect(scrubSensitivePaths("ran inspect with --json on src/app.tsx")).toBe(
      "ran inspect with --json on src/app.tsx",
    );
  });
});
