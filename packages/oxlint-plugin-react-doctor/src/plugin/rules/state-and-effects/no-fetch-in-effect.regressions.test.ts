import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFetchInEffect } from "./no-fetch-in-effect.js";

const expectFail = (code: string): void => {
  const result = runRule(noFetchInEffect, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(noFetchInEffect, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("state-and-effects/no-fetch-in-effect — regressions", () => {
  it("does not flag a fetch cancelled via AbortController in the cleanup", () => {
    expectPass(`
      const useSubtitles = (subtitlesUrl) => {
        useEffect(() => {
          const controller = new AbortController();
          fetch(subtitlesUrl, { signal: controller.signal })
            .then((response) => response.text())
            .then(setSubtitles);
          return () => controller.abort();
        }, [subtitlesUrl]);
      };
    `);
  });

  it("does not flag a fetch guarded by a cancelled flag set in the cleanup", () => {
    expectPass(`
      const GithubSection = ({ isOpen }) => {
        useEffect(() => {
          if (!isOpen) return undefined;
          let isCancelled = false;
          const fetchAboutInfo = async () => {
            const response = await fetch("https://api.github.com/repos/x/y");
            if (isCancelled) return;
            setStars(await response.json());
          };
          fetchAboutInfo();
          return () => {
            isCancelled = true;
          };
        }, [isOpen]);
        return null;
      };
    `);
  });

  it("does not flag a call to a locally-declared fetch mock", () => {
    expectPass(`
      export default function ServerSidePaginationDemo() {
        const fetch = useCallback(async (page, perPage) => {
          const result = await fakeFetch(page, perPage);
          setData(result.rows);
        }, []);
        useEffect(() => {
          fetch(1, 10);
        }, []);
        return null;
      }
    `);
  });

  it("still flags a bare fetch with no cleanup", () => {
    expectFail(`
      const Widget = () => {
        useEffect(() => {
          fetch("/api/data")
            .then((response) => response.json())
            .then(setData);
        }, []);
        return null;
      };
    `);
  });

  it("still flags an imported fetch wrapper", () => {
    expectFail(`
      import { fetch } from "~/shared/fetch.client";
      const Logout = ({ urls }) => {
        useEffect(() => {
          Promise.allSettled(urls.map(async (url) => fetch(url, { method: "POST" })));
        }, [urls]);
        return null;
      };
    `);
  });

  it("still flags axios.get with an unrelated cleanup", () => {
    expectFail(`
      import axios from "axios";
      const Widget = () => {
        useEffect(() => {
          axios.get("/api/data").then(({ data }) => setData(data));
          const id = setInterval(poll, 1000);
          return () => clearInterval(id);
        }, []);
        return null;
      };
    `);
  });

  it("still flags fetch hidden in a component-scope helper", () => {
    expectFail(`
      const Profile = ({ url }) => {
        const [data, setData] = useState(null);
        const loadProfile = async () => {
          const response = await fetch(url);
          setData(await response.json());
        };
        useEffect(() => {
          void loadProfile();
        }, [url]);
        return <div>{data?.name}</div>;
      };
    `);
  });

  it("still flags fetch when cleanup only toggles an unrelated boolean", () => {
    expectFail(`
      const Profile = ({ url }) => {
        const [data, setData] = useState(null);
        useEffect(() => {
          fetch(url).then((response) => response.json()).then(setData);
          return () => {
            windowFocusTracker.isSubscribed = false;
          };
        }, [url]);
        return <div>{data?.name}</div>;
      };
    `);
  });

  it("still flags XMLHttpRequest inside an effect", () => {
    expectFail(`
      const Profile = ({ url }) => {
        const [data, setData] = useState(null);
        useEffect(() => {
          const request = new XMLHttpRequest();
          request.open("GET", url);
          request.onload = () => setData(JSON.parse(request.responseText));
          request.send();
        }, [url]);
        return <div>{data?.name}</div>;
      };
    `);
  });
});
