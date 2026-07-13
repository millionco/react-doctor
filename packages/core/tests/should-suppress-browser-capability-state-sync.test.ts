import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { parseOxlintOutput } from "../src/runners/oxlint/parse-output.js";
import { shouldSuppressBrowserCapabilityStateSync } from "../src/runners/oxlint/should-suppress-browser-capability-state-sync.js";
import { buildProject } from "./helpers/oxlint-parse-harness.js";

let temporaryRoot: string;

beforeEach(() => {
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "browser-capability-state-sync-"));
});

afterEach(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

const buildDiagnostic = (contents: string, needle = "setPlayableVideoKey(") => ({
  code: "react-hooks-js(set-state-in-effect)",
  filename: "component.tsx",
  labels: [
    {
      span: {
        offset: Buffer.byteLength(contents.slice(0, contents.indexOf(needle))),
      },
    },
  ],
});

const isSuppressed = (contents: string, needle?: string): boolean => {
  fs.writeFileSync(path.join(temporaryRoot, "component.tsx"), contents);
  return shouldSuppressBrowserCapabilityStateSync(buildDiagnostic(contents, needle), temporaryRoot);
};

describe("shouldSuppressBrowserCapabilityStateSync", () => {
  it("suppresses the direct Jumper media capability synchronization", () => {
    const contents = `import { useEffect, useState } from "react";
const video = document.createElement("video");

export const Background = ({ videoKey, videoMime }: { videoKey: string; videoMime: string }) => {
  const [playableVideoKey, setPlayableVideoKey] = useState(null);
  useEffect(() => {
    setPlayableVideoKey(video.canPlayType(videoMime) !== "" ? videoKey : null);
  }, [videoKey, videoMime]);
  return playableVideoKey;
};
`;

    expect(isSuppressed(contents)).toBe(true);
  });

  it("keeps direct capability synchronization without dependencies reportable", () => {
    const contents = `import { useEffect, useState } from "react";
const video = document.createElement("video");

export const Background = ({ videoKey, videoMime }: { videoKey: string; videoMime: string }) => {
  const [playableVideoKey, setPlayableVideoKey] = useState(null);
  useEffect(() => {
    setPlayableVideoKey(video.canPlayType(videoMime) !== "" ? videoKey : null);
  });
  return playableVideoKey;
};
`;

    expect(isSuppressed(contents)).toBe(false);
  });

  it("keeps local aliases and helpers outside the narrow provenance boundary", () => {
    const contents = `import { useEffect, useState } from "react";

export const Background = ({ videoKey, videoMime }) => {
  const [playableVideoKey, setPlayableVideoKey] = useState(null);
  useEffect(() => {
    const video = document.createElement("video");
    const readSupport = (candidate) => video.canPlayType(candidate);
    const support = readSupport(videoMime);
    const nextPlayableVideoKey = support !== "" ? videoKey : null;
    setPlayableVideoKey(nextPlayableVideoKey);
  }, [videoKey, videoMime]);
  return playableVideoKey;
};
`;

    expect(isSuppressed(contents)).toBe(false);
  });

  it("keeps state writes guarded by browser capability reportable", () => {
    const contents = `import { useEffect, useState } from "react";

export const Background = ({ videoKey, videoMime }) => {
  const [playableVideoKey, setPlayableVideoKey] = useState(null);
  useEffect(() => {
    const video = document.createElement("video");
    if (video.canPlayType(videoMime) !== "") {
      setPlayableVideoKey(videoKey);
    } else {
      setPlayableVideoKey(null);
    }
  }, [videoKey, videoMime]);
  return playableVideoKey;
};
`;

    expect(isSuppressed(contents)).toBe(false);
    expect(isSuppressed(contents, "setPlayableVideoKey(null)")).toBe(false);
  });

  it("keeps functional state updates guarded by browser capability reportable", () => {
    const contents = `import { useEffect, useState } from "react";

export const Background = ({ videoMime }: { videoMime: string }) => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const video = document.createElement("video");
    if (video.canPlayType(videoMime) !== "") {
      setCount((currentCount) => currentCount + 1);
    }
  }, [videoMime]);
  return count;
};
`;

    expect(isSuppressed(contents, "setCount(")).toBe(false);
  });

  it("keeps fresh objects containing capability results reportable", () => {
    const contents = `import { useEffect, useState } from "react";
const video = document.createElement("video");

export const Background = ({ videoMime }: { videoMime: string }) => {
  const [state, setState] = useState({ support: "" });
  useEffect(() => {
    setState({ support: video.canPlayType(videoMime) });
  }, [videoMime]);
  return state.support;
};
`;

    expect(isSuppressed(contents, "setState(")).toBe(false);
  });

  it("keeps functional updaters containing capability results reportable", () => {
    const contents = `import { useEffect, useState } from "react";
const video = document.createElement("video");

export const Background = ({ videoMime }: { videoMime: string }) => {
  const [state, setState] = useState({ support: "" });
  useEffect(() => {
    setState((currentState) => ({
      ...currentState,
      support: video.canPlayType(videoMime),
    }));
  }, [videoMime]);
  return state.support;
};
`;

    expect(isSuppressed(contents, "setState(")).toBe(false);
  });

  it("keeps current-state arithmetic involving capability results reportable", () => {
    const contents = `import { useEffect, useState } from "react";
const video = document.createElement("video");

export const Background = ({ videoMime }: { videoMime: string }) => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(count + video.canPlayType(videoMime).length);
  }, [count, videoMime]);
  return count;
};
`;

    expect(isSuppressed(contents, "setCount(")).toBe(false);
  });

  it("keeps wrapper calls reportable even when passed a capability result", () => {
    const contents = `import { useEffect, useState } from "react";
const video = document.createElement("video");
const buildState = (_support) => ({ fresh: true });

export const Background = ({ videoMime }: { videoMime: string }) => {
  const [state, setState] = useState({ fresh: false });
  useEffect(() => {
    setState(buildState(video.canPlayType(videoMime)));
  }, [videoMime]);
  return state.fresh;
};
`;

    expect(isSuppressed(contents, "setState(")).toBe(false);
  });

  it("suppresses a stable guarded capability result", () => {
    const contents = `import { useEffect, useState } from "react";
const video = document.createElement("video");

export const Background = ({ videoMime }: { videoMime: string }) => {
  const [support, setSupport] = useState("");
  useEffect(() => {
    setSupport(video ? video.canPlayType(videoMime) : "");
  }, [videoMime]);
  return support;
};
`;

    expect(isSuppressed(contents, "setSupport(")).toBe(true);
  });

  it("keeps newly allocated video elements returned as state reportable", () => {
    const contents = `import { useEffect, useState } from "react";

export const Background = ({ videoMime }: { videoMime: string }) => {
  const [playableVideo, setPlayableVideo] = useState(null);
  const video = document.createElement("video");
  useEffect(() => {
    setPlayableVideo(video.canPlayType(videoMime) !== "" ? video : null);
  }, [videoMime]);
  return playableVideo;
};
`;

    expect(isSuppressed(contents, "setPlayableVideo(")).toBe(false);
  });

  it("keeps type annotations and React refs without runtime provenance reportable", () => {
    const contents = `import { useEffect, useRef, useState } from "react";

interface HTMLVideoElement {
  canPlayType: (mime: string) => string;
}

export const Background = ({ codec, videoMime }) => {
  const [playableVideoKey, setPlayableVideoKey] = useState(null);
  const videoRef = useRef<HTMLVideoElement>(codec);
  useEffect(() => {
    setPlayableVideoKey(videoRef.current.canPlayType(videoMime));
  }, [codec, videoMime]);
  return playableVideoKey;
};
`;

    expect(isSuppressed(contents)).toBe(false);
  });

  it("keeps ordinary prop-derived state writes reportable", () => {
    const contents = `import { useEffect, useState } from "react";

export const Background = ({ videoKey }) => {
  const [playableVideoKey, setPlayableVideoKey] = useState(null);
  useEffect(() => {
    setPlayableVideoKey(videoKey);
  }, [videoKey]);
  return playableVideoKey;
};
`;

    expect(isSuppressed(contents)).toBe(false);
  });

  it("keeps an unrelated state write after a capability query reportable", () => {
    const contents = `import { useEffect, useState } from "react";

export const Background = ({ videoMime }) => {
  const [playableVideoKey, setPlayableVideoKey] = useState(null);
  useEffect(() => {
    const video = document.createElement("video");
    video.canPlayType(videoMime);
    setPlayableVideoKey("loading");
  }, [videoMime]);
  return playableVideoKey;
};
`;

    expect(isSuppressed(contents)).toBe(false);
  });

  it("keeps similarly named methods on unknown receivers reportable", () => {
    const contents = `import { useEffect, useState } from "react";

export const Background = ({ codec, videoMime }) => {
  const [playableVideoKey, setPlayableVideoKey] = useState(null);
  useEffect(() => {
    setPlayableVideoKey(codec.canPlayType(videoMime));
  }, [codec, videoMime]);
  return playableVideoKey;
};
`;

    expect(isSuppressed(contents)).toBe(false);
  });

  it("keeps shadowed document factories reportable", () => {
    const contents = `import { useEffect, useState } from "react";

export const Background = ({ document, videoMime }) => {
  const [playableVideoKey, setPlayableVideoKey] = useState(null);
  useEffect(() => {
    const video = document.createElement("video");
    setPlayableVideoKey(video.canPlayType(videoMime));
  }, [document, videoMime]);
  return playableVideoKey;
};
`;

    expect(isSuppressed(contents)).toBe(false);
  });

  it("keeps loop-bound document factories reportable", () => {
    const contents = `import { useEffect, useState } from "react";

export const Background = ({ documents, videoMime }) => {
  const [playableVideoKey, setPlayableVideoKey] = useState(null);
  useEffect(() => {
    for (const document of documents) {
      const video = document.createElement("video");
      setPlayableVideoKey(video.canPlayType(videoMime));
    }
  }, [documents, videoMime]);
  return playableVideoKey;
};
`;

    expect(isSuppressed(contents)).toBe(false);
  });

  it("keeps imported document factories reportable", () => {
    const contents = `import { useEffect, useState } from "react";
import document from "./userland-document";
const video = document.createElement("video");

export const Background = ({ videoKey, videoMime }) => {
  const [playableVideoKey, setPlayableVideoKey] = useState(null);
  useEffect(() => {
    setPlayableVideoKey(video.canPlayType(videoMime) !== "" ? videoKey : null);
  }, [videoKey, videoMime]);
  return playableVideoKey;
};
`;

    expect(isSuppressed(contents)).toBe(false);
  });

  it("keeps import-equals document factories reportable", () => {
    const contents = `import { useEffect, useState } from "react";
import document = require("./userland-document");
const video = document.createElement("video");

export const Background = ({ videoKey, videoMime }: { videoKey: string; videoMime: string }) => {
  const [playableVideoKey, setPlayableVideoKey] = useState(null);
  useEffect(() => {
    setPlayableVideoKey(video.canPlayType(videoMime) !== "" ? videoKey : null);
  }, [videoKey, videoMime]);
  return playableVideoKey;
};
`;

    expect(isSuppressed(contents)).toBe(false);
  });

  it("keeps namespace document factories reportable", () => {
    const contents = `import { useEffect, useState } from "react";
namespace document {
  export const createElement = () => ({ canPlayType: () => "probably" });
}
const video = document.createElement("video");

export const Background = ({ videoKey, videoMime }: { videoKey: string; videoMime: string }) => {
  const [playableVideoKey, setPlayableVideoKey] = useState(null);
  useEffect(() => {
    setPlayableVideoKey(video.canPlayType(videoMime) !== "" ? videoKey : null);
  }, [videoKey, videoMime]);
  return playableVideoKey;
};
`;

    expect(isSuppressed(contents)).toBe(false);
  });

  it("keeps reassigned video bindings reportable", () => {
    const contents = `import { useEffect, useState } from "react";
let video = document.createElement("video");

export const Background = ({ codec, videoKey, videoMime }) => {
  const [playableVideoKey, setPlayableVideoKey] = useState(null);
  useEffect(() => {
    video = codec;
    setPlayableVideoKey(video.canPlayType(videoMime) !== "" ? videoKey : null);
  }, [codec, videoKey, videoMime]);
  return playableVideoKey;
};
`;

    expect(isSuppressed(contents)).toBe(false);
  });

  it("keeps unrelated destructured capability methods reportable", () => {
    const contents = `import { useEffect, useState } from "react";

export const Background = ({ codec, videoKey, videoMime }) => {
  const [playableVideoKey, setPlayableVideoKey] = useState(null);
  const { canPlayType } = codec;
  useEffect(() => {
    setPlayableVideoKey(canPlayType(videoMime) !== "" ? videoKey : null);
  }, [canPlayType, videoKey, videoMime]);
  return playableVideoKey;
};
`;

    expect(isSuppressed(contents)).toBe(false);
  });

  it("keeps helpers with alternate returns and parameter reassignment reportable", () => {
    const contents = `import { useEffect, useState } from "react";
const video = document.createElement("video");

const readSupport = (candidate, fallback) => {
  candidate = fallback;
  if (fallback) return "probably";
  return video.canPlayType(candidate);
};

export const Background = ({ fallback, videoKey, videoMime }) => {
  const [playableVideoKey, setPlayableVideoKey] = useState(null);
  useEffect(() => {
    setPlayableVideoKey(readSupport(videoMime, fallback) !== "" ? videoKey : null);
  }, [fallback, videoKey, videoMime]);
  return playableVideoKey;
};
`;

    expect(isSuppressed(contents)).toBe(false);
  });

  it("keeps reassigned state-selection parameters reportable", () => {
    const contents = `import { useEffect, useState } from "react";
const video = document.createElement("video");

export const Background = ({ fallback, videoKey, videoMime }) => {
  const [playableVideoKey, setPlayableVideoKey] = useState(null);
  videoKey = fallback;
  useEffect(() => {
    setPlayableVideoKey(video.canPlayType(videoMime) !== "" ? videoKey : null);
  }, [videoKey, videoMime]);
  return playableVideoKey;
};
`;

    expect(isSuppressed(contents)).toBe(false);
  });

  it("keeps defaulted destructured parameters reportable", () => {
    const contents = `import { useEffect, useState } from "react";
const video = document.createElement("video");

export const Background = ({ initial = {}, videoMime }: { initial?: object; videoMime: string }) => {
  const [state, setState] = useState(null);
  useEffect(() => {
    setState(video.canPlayType(videoMime) !== "" ? initial : null);
  }, [initial, videoMime]);
  return state;
};
`;

    expect(isSuppressed(contents, "setState(")).toBe(false);
  });

  it("keeps defaulted direct parameters reportable", () => {
    const contents = `import { useEffect, useState } from "react";
const video = document.createElement("video");

export const Background = (initial = []) => {
  const [state, setState] = useState(null);
  useEffect(() => {
    setState(video.canPlayType("video/mp4") !== "" ? initial : null);
  }, [initial]);
  return state;
};
`;

    expect(isSuppressed(contents, "setState(")).toBe(false);
  });

  it("keeps direct rest parameters reportable", () => {
    const contents = `import { useEffect, useState } from "react";
const video = document.createElement("video");

export const Background = (...values) => {
  const [state, setState] = useState(null);
  useEffect(() => {
    setState(video.canPlayType("video/mp4") !== "" ? values : null);
  }, [values]);
  return state;
};
`;

    expect(isSuppressed(contents, "setState(")).toBe(false);
  });

  it("keeps destructured rest parameters reportable", () => {
    const contents = `import { useEffect, useState } from "react";
const video = document.createElement("video");

export const Background = ({ videoMime, ...values }: { videoMime: string; [key: string]: unknown }) => {
  const [state, setState] = useState(null);
  useEffect(() => {
    setState(video.canPlayType(videoMime) !== "" ? values : null);
  }, [values, videoMime]);
  return state;
};
`;

    expect(isSuppressed(contents, "setState(")).toBe(false);
  });

  it("keeps side-effectful capability arguments reportable", () => {
    const contents = `import { useEffect, useState } from "react";
const video = document.createElement("video");

export const Background = ({ getAlternatingMime }) => {
  const [support, setSupport] = useState("");
  useEffect(() => {
    setSupport(video.canPlayType(getAlternatingMime()));
  }, [getAlternatingMime]);
  return support;
};
`;

    expect(isSuppressed(contents, "setSupport(")).toBe(false);
  });

  it("keeps random capability arguments reportable", () => {
    const contents = `import { useEffect, useState } from "react";
const video = document.createElement("video");

export const Background = () => {
  const [support, setSupport] = useState("");
  useEffect(() => {
    setSupport(video.canPlayType(Math.random() > 0.5 ? "video/mp4" : "x"));
  }, []);
  return support;
};
`;

    expect(isSuppressed(contents, "setSupport(")).toBe(false);
  });

  it("keeps coercible object capability arguments reportable", () => {
    const contents = `import { useEffect, useState } from "react";
const video = document.createElement("video");

export const Background = ({ videoMime }: { videoMime: any }) => {
  const [support, setSupport] = useState("");
  useEffect(() => {
    setSupport(video.canPlayType(videoMime));
  }, [videoMime]);
  return support;
};
`;

    expect(isSuppressed(contents, "setSupport(")).toBe(false);
  });

  it("keeps monkeypatched capability methods reportable", () => {
    const contents = `import { useEffect, useState } from "react";
const video = document.createElement("video");
let isSupported = false;
video.canPlayType = () => {
  isSupported = !isSupported;
  return isSupported ? "probably" : "";
};

export const Background = ({ videoMime }: { videoMime: string }) => {
  const [support, setSupport] = useState("");
  useEffect(() => {
    setSupport(video.canPlayType(videoMime));
  }, [videoMime]);
  return support;
};
`;

    expect(isSuppressed(contents, "setSupport(")).toBe(false);
  });

  it("keeps capability mutations through video aliases reportable", () => {
    const contents = `import { useEffect, useState } from "react";
const video = document.createElement("video");
const alias = video;
alias.canPlayType = () => "probably";

export const Background = ({ videoMime }: { videoMime: string }) => {
  const [support, setSupport] = useState("");
  useEffect(() => {
    setSupport(video.canPlayType(videoMime));
  }, [videoMime]);
  return support;
};
`;

    expect(isSuppressed(contents, "setSupport(")).toBe(false);
  });

  it("keeps escaped video bindings reportable", () => {
    const contents = `import { useEffect, useState } from "react";
const video = document.createElement("video");
mutate(video);

export const Background = ({ videoMime }: { videoMime: string }) => {
  const [support, setSupport] = useState("");
  useEffect(() => {
    setSupport(video.canPlayType(videoMime));
  }, [videoMime]);
  return support;
};
`;

    expect(isSuppressed(contents, "setSupport(")).toBe(false);
  });

  it("keeps video bindings stored in objects reportable", () => {
    const contents = `import { useEffect, useState } from "react";
const video = document.createElement("video");
const holder = { video };
holder.video.canPlayType = () => "probably";

export const Background = ({ videoMime }: { videoMime: string }) => {
  const [support, setSupport] = useState("");
  useEffect(() => {
    setSupport(video.canPlayType(videoMime));
  }, [videoMime]);
  return support;
};
`;

    expect(isSuppressed(contents, "setSupport(")).toBe(false);
  });

  it("keeps mutated document factories reportable", () => {
    const contents = `import { useEffect, useState } from "react";
document["createElement"] = () => ({ canPlayType: () => "probably" });
const video = document.createElement("video");

export const Background = ({ videoMime }: { videoMime: string }) => {
  const [support, setSupport] = useState("");
  useEffect(() => {
    setSupport(video.canPlayType(videoMime));
  }, [videoMime]);
  return support;
};
`;

    expect(isSuppressed(contents, "setSupport(")).toBe(false);
  });

  it("keeps mutated media element prototypes reportable", () => {
    const contents = `import { useEffect, useState } from "react";
HTMLMediaElement.prototype["canPlayType"] = () => "probably";
const video = document.createElement("video");

export const Background = ({ videoMime }: { videoMime: string }) => {
  const [support, setSupport] = useState("");
  useEffect(() => {
    setSupport(video.canPlayType(videoMime));
  }, [videoMime]);
  return support;
};
`;

    expect(isSuppressed(contents, "setSupport(")).toBe(false);
  });

  it("keeps mutations through document aliases reportable", () => {
    const contents = `import { useEffect, useState } from "react";
const documentAlias = document;
documentAlias.createElement = () => ({ canPlayType: () => "probably" });
const video = document.createElement("video");

export const Background = ({ videoMime }: { videoMime: string }) => {
  const [support, setSupport] = useState("");
  useEffect(() => {
    setSupport(video.canPlayType(videoMime));
  }, [videoMime]);
  return support;
};
`;

    expect(isSuppressed(contents, "setSupport(")).toBe(false);
  });

  it("keeps mutations through media prototype aliases reportable", () => {
    const contents = `import { useEffect, useState } from "react";
const mediaPrototype = HTMLMediaElement.prototype;
mediaPrototype.canPlayType = () => "probably";
const video = document.createElement("video");

export const Background = ({ videoMime }: { videoMime: string }) => {
  const [support, setSupport] = useState("");
  useEffect(() => {
    setSupport(video.canPlayType(videoMime));
  }, [videoMime]);
  return support;
};
`;

    expect(isSuppressed(contents, "setSupport(")).toBe(false);
  });

  it("keeps unproven imported capability helpers reportable", () => {
    const contents = `import { useEffect, useState } from "react";
import { canBrowserPlayVideoMime } from "./media";

export const Background = ({ videoMime }) => {
  const [playableVideoKey, setPlayableVideoKey] = useState(null);
  useEffect(() => {
    setPlayableVideoKey(canBrowserPlayVideoMime(videoMime));
  }, [videoMime]);
  return playableVideoKey;
};
`;

    expect(isSuppressed(contents)).toBe(false);
  });

  it("ignores other compiler diagnostics", () => {
    const contents = `const video = document.createElement("video");
setPlayableVideoKey(video.canPlayType(videoMime));
`;
    fs.writeFileSync(path.join(temporaryRoot, "component.tsx"), contents);
    const diagnostic = buildDiagnostic(contents);

    expect(
      shouldSuppressBrowserCapabilityStateSync(
        { ...diagnostic, code: "react-hooks-js(set-state-in-render)" },
        temporaryRoot,
      ),
    ).toBe(false);
  });

  it("aligns direct capability synchronization with callback-indirected synchronization", () => {
    const contents = `import { useEffect, useState } from "react";
const video = document.createElement("video");

const CapabilityProbe = ({ mime, onPlaybackUnavailable }) => {
  useEffect(() => {
    if (video.canPlayType(mime) === "") onPlaybackUnavailable();
  }, [mime, onPlaybackUnavailable]);
  return null;
};

export const Background = ({ mime, videoKey }: { mime: string; videoKey: string }) => {
  const [playableVideoKey, setPlayableVideoKey] = useState(null);
  useEffect(() => {
    setPlayableVideoKey(video.canPlayType(mime) !== "" ? videoKey : null);
  }, [mime, videoKey]);
  return (
    <CapabilityProbe
      mime={mime}
      onPlaybackUnavailable={() => setPlayableVideoKey(null)}
    />
  );
};
`;
    const filename = "component.tsx";
    fs.writeFileSync(path.join(temporaryRoot, filename), contents);
    const offset = Buffer.byteLength(contents.slice(0, contents.indexOf("setPlayableVideoKey(")));
    const stdout = JSON.stringify({
      diagnostics: [
        {
          message: "Calling setState synchronously within an effect can trigger cascading renders",
          code: "react-hooks-js(set-state-in-effect)",
          severity: "error",
          filename,
          labels: [{ label: "", span: { offset, length: 19, line: 13, column: 5 } }],
        },
      ],
    });

    expect(parseOxlintOutput(stdout, buildProject(), temporaryRoot)).toEqual([]);
  });
});
