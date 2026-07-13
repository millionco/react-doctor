import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEffectEventHandler } from "./no-effect-event-handler.js";

describe("state-and-effects/no-effect-event-handler regressions", () => {
  it("does not flag a guarded effect returning an unknown cleanup parameter", () => {
    const result = runRule(
      noEffectEventHandler,
      `const Component = ({ active, onEvent, cleanup }) => {
  useEffect(() => {
    if (active) onEvent();
    return cleanup;
  }, [active]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // Mined cloudscape FP (app-layout/mobile-toolbar): a prop-guarded body
  // scroll lock with a cleanup half. The cleanup cannot move into an
  // event handler, so the effect is synchronizing with an external
  // system, not simulating a handler.
  it("does not flag a guarded classList sync effect that returns a cleanup", () => {
    const code = `
import { useEffect } from "react";
const MobileToolbar = ({ anyPanelOpen }) => {
  useEffect(() => {
    if (anyPanelOpen) {
      document.body.classList.add("block-body-scroll");
      return () => {
        document.body.classList.remove("block-body-scroll");
      };
    } else {
      document.body.classList.remove("block-body-scroll");
    }
  }, [anyPanelOpen]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // Mined classicy FP (QuickTimeMovieEmbed subtitles): an abortable fetch
  // keyed to a prop with an early-return guard. The AbortController
  // cleanup marks it as a legitimate data-fetching effect.
  it("does not flag a guarded abortable fetch effect with cleanup", () => {
    const code = `
import { useEffect, useState } from "react";
const MovieEmbed = ({ subtitlesUrl }) => {
  const [subtitlesData, setSubtitlesData] = useState(null);
  useEffect(() => {
    if (!subtitlesUrl) {
      return;
    }
    const controller = new AbortController();
    fetch(subtitlesUrl, { signal: controller.signal })
      .then((res) => res.text())
      .then((text) => setSubtitlesData(text));
    return () => controller.abort();
  }, [subtitlesUrl]);
  return subtitlesData;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // Mined psysonic FP (PlayerStatsRecentDays): fetch with a cancelled
  // flag flipped in the cleanup — the You-Might-Not-Need-an-Effect race
  // protection pattern, not an event handler.
  it("does not flag a guarded fetch effect with a cancelled-flag cleanup", () => {
    const code = `
import { useEffect, useState } from "react";
const RecentDays = ({ liveRefreshKey }) => {
  const [days, setDays] = useState([]);
  useEffect(() => {
    if (liveRefreshKey === 0) return;
    let cancelled = false;
    fetch("/api/recent-days")
      .then((res) => res.json())
      .then((rows) => {
        if (cancelled) return;
        setDays(rows);
      });
    return () => { cancelled = true; };
  }, [liveRefreshKey]);
  return days.length;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // Mined glific FP (Auth): `if (mode === 'x') return;` excludes ONE prop
  // value and loads data on every other value including mount — default-path
  // data loading keyed to a route-derived prop, not "fire when prop flips".
  it("does not flag an equality-excluding early return before default-path data loading", () => {
    const code = `
import { useEffect, useState } from "react";
const Auth = ({ mode }) => {
  const [orgName, setOrgName] = useState('Glific');
  useEffect(() => {
    if (mode === 'trialregistration') {
      return;
    }
    axios.post(ORGANIZATION_NAME).then(({ data }) => setOrgName(data.name));
  }, [mode]);
  return orgName;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // The mirrored TP: `!==` + early return runs the side effect only when
  // the prop REACHES a specific value — the event-simulation shape.
  it("still flags an inequality early return gating a one-shot side effect", () => {
    const code = `
import { useEffect } from "react";
const Checkout = ({ status }) => {
  useEffect(() => {
    if (status !== 'submitted') {
      return;
    }
    toast('Order submitted!');
  }, [status]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  // TP shape retained: the canonical You-Might-Not-Need-an-Effect §6
  // example — a prop-guarded, cleanup-free effect firing a one-shot
  // user-visible side effect that belongs in the event handler.
  it("still flags a prop-guarded toast effect without cleanup", () => {
    const code = `
import { useEffect } from "react";
const ProductPage = ({ product }) => {
  useEffect(() => {
    if (product.isInCart) {
      toast("Added " + product.name + "!");
    }
  }, [product]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a prop-guarded navigation effect without cleanup", () => {
    const code = `
import { useEffect } from "react";
const Redirector = ({ isLoggedIn, router }) => {
  useEffect(() => {
    if (isLoggedIn) {
      router.push("/dashboard");
    }
  }, [isLoggedIn, router]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag external directory-store reconciliation guarded by component props", () => {
    const code = `
import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSync } from "@/context/sync";
const DirectoryDataProvider = (props) => {
  const location = useLocation();
  const navigate = useNavigate();
  const sync = useSync();
  const slug = useMemo(() => base64Encode(props.directory), [props.directory]);
  const directorySync = sync();
  const nextDirectory = directorySync.data.path.directory;

  useEffect(() => {
    if (props.draftID) return;
    const next = nextDirectory;
    if (!next || next === props.directory) return;
    const path = location.pathname.slice(slug.length + 1);
    navigate(\`/\${base64Encode(next)}\${path}\${location.search}\${location.hash}\`, {
      replace: true,
    });
  }, [
    props.draftID,
    props.directory,
    nextDirectory,
    location.pathname,
    location.search,
    location.hash,
    slug,
    navigate,
  ]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("classifies external synchronization without relying on an in-effect alias", () => {
    const code = `
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSync } from "@/context/sync";
const DirectoryDataProvider = (props) => {
  const navigate = useNavigate();
  const sync = useSync();
  const directorySync = sync();
  const nextDirectory = directorySync.data.path.directory;

  useEffect(() => {
    if (props.draftID) return;
    if (!nextDirectory || nextDirectory === props.directory) return;
    navigate(encodeDirectory(nextDirectory), { replace: true });
  }, [props.draftID, props.directory, nextDirectory, navigate]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not assume that every opaque custom-hook value is an external snapshot", () => {
    const code = `
import { useEffect } from "react";
const DirectoryProvider = ({ draftId, directory, navigate }) => {
  const nextDirectory = useExternalDirectory();
  useEffect(() => {
    if (draftId) return;
    if (!nextDirectory || nextDirectory === directory) return;
    navigate(encodeDirectory(nextDirectory), { replace: true });
  }, [draftId, directory, nextDirectory, navigate]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows TypeScript wrappers and multi-hop const aliases to an external snapshot", () => {
    const code = `
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSync } from "@/context/sync";
interface Snapshot { path: { directory?: string } }
const DirectoryProvider = ({ draftId, directory }) => {
  const navigate = useNavigate();
  const sync = useSync();
  const snapshot = sync() as Snapshot;
  const nextDirectory = snapshot.path.directory;
  const candidateDirectory = nextDirectory;
  useEffect(() => {
    if (draftId) return;
    const next = candidateDirectory;
    if (!next || next === directory) return;
    navigate(encodeDirectory(next), { replace: true });
  }, [draftId, directory, candidateDirectory, navigate]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags prop-gated notifications driven by local React state", () => {
    const code = `
import { useEffect, useState } from "react";
const Notifications = ({ enabled }) => {
  const [message] = useState();
  useEffect(() => {
    if (!enabled) return;
    if (!message) return;
    toast(message);
  }, [enabled, message]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a prop-gated event relay when the derived payload consumes props", () => {
    const code = `
import { useEffect } from "react";
const Notifications = ({ enabled, product }) => {
  const message = buildMessage(product);
  useEffect(() => {
    if (!enabled) return;
    if (!message) return;
    toast(message);
  }, [enabled, message]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a prop-gated event relay using an ordinary zero-argument builder", () => {
    const code = `
import { useEffect } from "react";
const Notifications = ({ enabled }) => {
  const message = buildMessage();
  useEffect(() => {
    if (!enabled) return;
    if (!message) return;
    toast(message);
  }, [enabled, message]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a prop-gated event relay using a factory-returned builder", () => {
    const code = `
import { useEffect } from "react";
const Notifications = ({ enabled }) => {
  const buildMessage = makeMessageBuilder();
  const message = buildMessage();
  useEffect(() => {
    if (!enabled) return;
    if (!message) return;
    toast(message);
  }, [enabled, message]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a prop-gated event relay driven by state hidden in a local custom hook", () => {
    const code = `
import { useEffect, useState } from "react";
const useMessage = () => useState("")[0];
const Notifications = ({ enabled }) => {
  const message = useMessage();
  useEffect(() => {
    if (!enabled) return;
    if (!message) return;
    toast(message);
  }, [enabled, message]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a local custom-hook accessor over React state", () => {
    const code = `
import { useEffect, useState } from "react";
const useMessageAccessor = () => {
  const [state] = useState({ message: "" });
  return () => state;
};
const Notifications = ({ enabled }) => {
  const readMessage = useMessageAccessor();
  const message = readMessage().message;
  useEffect(() => {
    if (!enabled) return;
    if (!message) return;
    toast(message);
  }, [enabled, message]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an imported custom-hook accessor without a reconciliation comparison", () => {
    const code = `
import { useEffect } from "react";
import { useMessageAccessor } from "./hooks";
const Notifications = ({ enabled }) => {
  const readMessage = useMessageAccessor();
  const message = readMessage().message;
  useEffect(() => {
    if (!enabled) return;
    if (!message) return;
    toast(message);
  }, [enabled, message]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an imported custom-hook accessor used for a one-shot notification", () => {
    const code = `
import { useEffect } from "react";
import { useMessageAccessor } from "./hooks";
const Notifications = (props) => {
  const readMessage = useMessageAccessor();
  const message = readMessage().message;
  useEffect(() => {
    if (!props.enabled) return;
    if (!message || message === props.lastNotifiedMessage) return;
    toast(message);
  }, [props.enabled, props.lastNotifiedMessage, message]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("classifies replacement navigation independently of snapshot property mutation", () => {
    const code = `
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSync } from "@/context/sync";
const DirectoryProvider = (props) => {
  const navigate = useNavigate();
  const sync = useSync();
  const snapshot = sync();
  snapshot.data.path.directory = props.fallbackDirectory;
  const nextDirectory = snapshot.data.path.directory;
  useEffect(() => {
    if (props.draftId) return;
    if (!nextDirectory || nextDirectory === props.directory) return;
    navigate(encodeDirectory(nextDirectory), { replace: true });
  }, [props.draftId, props.directory, nextDirectory, navigate]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("classifies replacement navigation independently of aliased snapshot mutation", () => {
    const code = `
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSync } from "@/context/sync";
const DirectoryProvider = (props) => {
  const navigate = useNavigate();
  const sync = useSync();
  const snapshot = sync();
  const snapshotAlias = snapshot;
  snapshotAlias.data.path.directory = props.fallbackDirectory;
  const nextDirectory = snapshot.data.path.directory;
  useEffect(() => {
    if (props.draftId) return;
    if (!nextDirectory || nextDirectory === props.directory) return;
    navigate(encodeDirectory(nextDirectory), { replace: true });
  }, [props.draftId, props.directory, nextDirectory, navigate]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not misclassify local-state-to-router reconciliation as an event relay", () => {
    const code = `
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
const DirectoryProvider = (props) => {
  const navigate = useNavigate();
  const [nextDirectory] = useState(props.directory);
  useEffect(() => {
    if (props.draftId) return;
    if (!nextDirectory || nextDirectory === props.directory) return;
    navigate(encodeDirectory(nextDirectory), { replace: true });
  }, [props.draftId, props.directory, nextDirectory, navigate]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("supports aliased router imports and transparent snapshot wrappers", () => {
    const code = `
import { useEffect } from "react";
import { useNavigate as useRouterNavigate } from "react-router-dom";
import { useSync as useDirectorySync } from "@/context/sync";
interface Snapshot { data: { path: { directory?: string } } }
const DirectoryProvider = (props) => {
  const navigate = useRouterNavigate();
  const sync = useDirectorySync();
  const navigationOptions = getNavigationOptions();
  const snapshot = (sync() satisfies Snapshot)!;
  const nextDirectory = snapshot.data.path.directory;
  useEffect(() => {
    if (props.draftId) return;
    if (!nextDirectory || nextDirectory === props.directory) return;
    navigate(
      encodeDirectory(nextDirectory),
      ({ ...navigationOptions, replace: true } satisfies { replace: boolean }),
    );
  }, [props.draftId, props.directory, nextDirectory, navigate]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not assume replacement when a later spread can override the option", () => {
    const code = `
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSync } from "@/context/sync";
const DirectoryProvider = (props) => {
  const navigate = useNavigate();
  const sync = useSync();
  const navigationOptions = getNavigationOptions();
  const snapshot = sync();
  const nextDirectory = snapshot.data.path.directory;
  useEffect(() => {
    if (props.draftId) return;
    if (!nextDirectory || nextDirectory === props.directory) return;
    navigate(encodeDirectory(nextDirectory), { replace: true, ...navigationOptions });
  }, [props.draftId, props.directory, nextDirectory, navigate]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("supports a computed replacement key with an immutable boolean alias", () => {
    const code = `
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
const DirectoryProvider = (props) => {
  const navigate = useNavigate();
  const nextDirectory = readNextDirectory();
  const shouldReplace = true;
  useEffect(() => {
    if (!props.enabled) return;
    if (!nextDirectory || nextDirectory === props.directory) return;
    navigate(encodeDirectory(nextDirectory), { ["replace"]: shouldReplace });
  }, [props.enabled, props.directory, nextDirectory, navigate]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust a dynamic navigation option key", () => {
    const code = `
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
const DirectoryProvider = (props) => {
  const navigate = useNavigate();
  const nextDirectory = readNextDirectory();
  const optionName = readOptionName();
  useEffect(() => {
    if (!props.enabled) return;
    if (!nextDirectory || nextDirectory === props.directory) return;
    navigate(encodeDirectory(nextDirectory), { replace: true, [optionName]: false });
  }, [props.enabled, props.directory, nextDirectory, navigate]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not follow an aliased mutable navigation options object", () => {
    const code = `
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
const DirectoryProvider = (props) => {
  const navigate = useNavigate();
  const nextDirectory = readNextDirectory();
  const navigationOptions = { replace: true };
  navigationOptions.replace = props.shouldReplace;
  useEffect(() => {
    if (!props.enabled) return;
    if (!nextDirectory || nextDirectory === props.directory) return;
    navigate(encodeDirectory(nextDirectory), navigationOptions);
  }, [props.enabled, props.directory, nextDirectory, navigate, navigationOptions]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags fixed-destination navigation triggered by reconciliation state", () => {
    const code = `
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
const Notifications = (props) => {
  const navigate = useNavigate();
  const message = readMessage();
  useEffect(() => {
    if (!props.enabled) return;
    if (!message || message === props.lastMessage) return;
    navigate("/notifications", { replace: true, state: { message } });
  }, [props.enabled, props.lastMessage, message, navigate]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows immutable destination aliases into replacement navigation", () => {
    const code = `
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
const DirectoryProvider = (props) => {
  const navigate = useNavigate();
  const nextDirectory = readNextDirectory();
  useEffect(() => {
    if (!props.enabled) return;
    if (!nextDirectory || nextDirectory === props.directory) return;
    const encodedDestination = encodeDirectory(nextDirectory);
    const destination = (encodedDestination satisfies string)!;
    navigate(destination, { replace: true });
  }, [props.enabled, props.directory, nextDirectory, navigate]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not follow a reassigned destination into replacement navigation", () => {
    const code = `
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
const DirectoryProvider = (props) => {
  const navigate = useNavigate();
  const nextDirectory = readNextDirectory();
  useEffect(() => {
    if (!props.enabled) return;
    if (!nextDirectory || nextDirectory === props.directory) return;
    let destination = encodeDirectory(nextDirectory);
    destination = props.fallbackDestination;
    navigate(destination, { replace: true });
  }, [props.enabled, props.directory, nextDirectory, navigate]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags additional one-shot side effects beside router reconciliation", () => {
    const code = `
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
const DirectoryProvider = (props) => {
  const navigate = useNavigate();
  const nextDirectory = readNextDirectory();
  useEffect(() => {
    if (!props.enabled) return;
    if (!nextDirectory || nextDirectory === props.directory) return;
    toast("Directory changed");
    navigate(encodeDirectory(nextDirectory), { replace: true });
  }, [props.enabled, props.directory, nextDirectory, navigate]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not confuse a shadowed useNavigate binding with the router import", () => {
    const code = `
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
const DirectoryProvider = (props) => {
  const useNavigate = useNotificationNavigator;
  const navigate = useNavigate();
  const nextDirectory = readNextDirectory();
  useEffect(() => {
    if (!props.enabled) return;
    if (!nextDirectory || nextDirectory === props.directory) return;
    navigate(encodeDirectory(nextDirectory), { replace: true });
  }, [props.enabled, props.directory, nextDirectory, navigate]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a prop-gated event relay using a stable React hook value", () => {
    const code = `
import { useEffect, useId } from "react";
const Notifications = ({ enabled }) => {
  const messageId = useId();
  useEffect(() => {
    if (!enabled) return;
    if (!messageId) return;
    toast(messageId);
  }, [enabled, messageId]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a reassigned external-looking binding", () => {
    const code = `
import { useEffect } from "react";
const Redirector = ({ enabled, fallbackDirectory, navigate }) => {
  let nextDirectory = useExternalDirectory();
  nextDirectory = fallbackDirectory;
  useEffect(() => {
    if (!enabled) return;
    if (!nextDirectory) return;
    navigate(encodeDirectory(nextDirectory), { replace: true });
  }, [enabled, nextDirectory, navigate]);
  return null;
};
`;
    const result = runRule(noEffectEventHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
