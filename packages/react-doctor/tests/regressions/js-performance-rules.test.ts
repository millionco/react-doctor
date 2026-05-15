import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { collectRuleHits, setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-js-performance-rules-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("async-await-in-loop", () => {
  it("flags async forEach callbacks even when an awaited local is reused later", async () => {
    const projectDir = setupReactProject(tempRoot, "async-foreach-local-await", {
      files: {
        "src/save-users.ts": `
          export const saveUsers = async (users: Array<{ id: string }>, database: Database) => {
            users.forEach(async (user) => {
              const userRecord = await database.users.find(user.id);
              await database.write(async () => {
                await userRecord.update((draft) => {
                  Object.assign(draft, user);
                });
              });
            });
          };

          interface Database {
            users: {
              find: (id: string) => Promise<{ update: (callback: (draft: unknown) => void) => Promise<void> }>;
            };
            write: (callback: () => Promise<void>) => Promise<void>;
          }
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-await-in-loop");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("Async callback in .forEach");
  });

  it("flags async iteration callbacks even when they assign awaited arguments", async () => {
    const projectDir = setupReactProject(tempRoot, "async-callback-assigned-argument", {
      files: {
        "src/search-plugins.ts": `
          export const searchPlugins = (plugins: Plugin[], initialQuery: string | undefined) => {
            let query = initialQuery;
            plugins.forEach(async (plugin) => {
              query = query ?? plugin.defaultQuery;
              await plugin.search(query);
            });
          };

          interface Plugin {
            defaultQuery: string;
            search: (query: string) => Promise<void>;
          }
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-await-in-loop");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("Async callback in .forEach");
  });

  it("does not flag async map callbacks passed directly to Promise.all", async () => {
    const projectDir = setupReactProject(tempRoot, "async-map-promise-all", {
      files: {
        "src/fetch-series.ts": `
          export const fetchSeries = async (entries: Entry[]) => {
            const series = await Promise.all(
              entries.map(async (entry) => {
                const response = await fetch(entry.url);
                return response.json();
              }),
            );
            return series;
          };

          interface Entry {
            url: string;
          }
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-await-in-loop");
    expect(hits).toHaveLength(0);
  });

  it("flags async map expression bodies with TypeScript const assertions", async () => {
    const projectDir = setupReactProject(tempRoot, "async-map-expression-const-assertion", {
      files: {
        "src/fetch-tuples.ts": `
          export const fetchTuples = (entries: Entry[]) => {
            return entries.map(
              async (entry, index) => [await fetch(entry.url), index] as const,
            );
          };

          interface Entry {
            url: string;
          }
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-await-in-loop");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("Async callback in .map");
  });

  it("does not flag loop-carried cursor awaits", async () => {
    const projectDir = setupReactProject(tempRoot, "async-loop-carried-cursor", {
      files: {
        "src/fetch-pages.ts": `
          export const fetchPages = async (firstCursor: string | null) => {
            let cursor = firstCursor;
            while (cursor) {
              const page = await fetchPage(cursor);
              cursor = page.nextCursor;
            }
          };

          declare const fetchPage: (cursor: string) => Promise<{ nextCursor: string | null }>;
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-await-in-loop");
    expect(hits).toHaveLength(0);
  });
});
