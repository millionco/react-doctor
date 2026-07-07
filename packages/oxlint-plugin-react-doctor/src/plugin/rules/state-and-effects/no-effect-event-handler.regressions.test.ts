import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEffectEventHandler } from "./no-effect-event-handler.js";

describe("state-and-effects/no-effect-event-handler regressions", () => {
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
});
