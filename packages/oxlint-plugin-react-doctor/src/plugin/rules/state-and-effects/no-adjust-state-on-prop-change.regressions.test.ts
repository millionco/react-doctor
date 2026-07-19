import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

describe("no-adjust-state-on-prop-change — regressions", () => {
  it("ships at warn severity, matching the derived-state family", () => {
    expect(noAdjustStateOnPropChange.severity).toBe("warn");
    expect(noAdjustStateOnPropChange.recommendation).toContain(
      "Avoid tracking the previous prop in more state",
    );
  });

  it("leaves the exact Brainly guarded prop mirror outside this effect rule", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function RadioGroup({ value }) {
        const [selectedValue, setSelectedValue] = useState(value ?? null);
        const [prevValue, setPrevValue] = useState(value);
        if (value !== prevValue) {
          setPrevValue(value);
          setSelectedValue(value ?? null);
        }
        return selectedValue;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("leaves a guarded previous-render trend tracker outside this effect rule", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Counter({ count }) {
        const [previousCount, setPreviousCount] = useState(count);
        const [trend, setTrend] = useState(null);
        if (count !== previousCount) {
          setPreviousCount(count);
          setTrend(count > previousCount ? "increasing" : "decreasing");
        }
        return trend;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on constant transition flags with a setTimeout sibling", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function FloatingSheet({ isOpen }) {
        const [isClosing, setIsClosing] = useState(false);
        const [isAnimating, setIsAnimating] = useState(false);
        const [height, setHeight] = useState(0);
        useEffect(() => {
          if (isOpen) {
            setIsClosing(false);
            setIsAnimating(true);
            setHeight(0);
            setTimeout(() => setIsAnimating(false), 300);
          }
        }, [isOpen]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a literal reset with cleanup", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function List({ items }) {
        const [selection, setSelection] = useState();
        useEffect(() => {
          setSelection(null);
          return () => setSelection(undefined);
        }, [items]);
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on synchronous resets beside subscription setup", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Feed({ source }) {
        const [selection, setSelection] = useState(null);
        useEffect(() => {
          setSelection(null);
          source.subscribe(() => refresh());
          window.addEventListener("focus", refresh);
          source.events.on("change", refresh);
        }, [source]);
        return selection;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a synchronous reset beside observer registration", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Feed({ source }) {
        const [selection, setSelection] = useState(null);
        useEffect(() => {
          setSelection(null);
          const observer = new ResizeObserver(() => refresh());
          observer.observe(source);
        }, [source]);
        return selection;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a synchronous reset beside a member-style HTTP request", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Search({ query }) {
        const [selection, setSelection] = useState(null);
        useEffect(() => {
          setSelection(null);
          void axios.get("/search", { params: { query } });
        }, [query]);
        return selection;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports a synchronous reset beside an unrelated get method", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Selection({ itemId, cache }) {
        const [selection, setSelection] = useState(null);
        useEffect(() => {
          setSelection(null);
          cache.get(itemId);
        }, [itemId, cache]);
        return selection;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports when external work only exists in an uninvoked nested function", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Selection({ itemId, source }) {
        const [selection, setSelection] = useState(null);
        useEffect(() => {
          setSelection(null);
          const subscribeLater = () => source.subscribe(refresh);
        }, [itemId, source]);
        return selection;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when a nested subscription helper is invoked by the effect", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Selection({ itemId, source }) {
        const [selection, setSelection] = useState(null);
        useEffect(() => {
          setSelection(null);
          const subscribe = () => source.subscribe(refresh);
          subscribe();
        }, [itemId, source]);
        return selection;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a literal reset beside a timer callback", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function List({ items }) {
        const [selection, setSelection] = useState();
        const [flash, setFlash] = useState(false);
        useEffect(() => {
          setSelection(null);
          setTimeout(() => setFlash(true), 100);
        }, [items]);
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports the published prop-keyed constant reset", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function List({ items }) {
        const [selection, setSelection] = useState();
        useEffect(() => {
          setSelection(null);
        }, [items]);
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on an opaque hook result member read", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Table({ pageSize }) {
        const pagination = usePaginationStore();
        const [page, setPage] = useState(1);
        useEffect(() => {
          setPage(pagination.current);
        }, [pageSize]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on the async fetch signature (.then flow) with a sync setLoading toggle", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Results({ query }) {
        const [loading, setLoading] = useState(false);
        const [data, setData] = useState(null);
        useEffect(() => {
          setLoading(true);
          fetchResults(query).then((result) => {
            setData(result);
            setLoading(false);
          });
        }, [query]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on the async fetch signature (await in an async IIFE)", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Results({ query }) {
        const [loading, setLoading] = useState(false);
        const [data, setData] = useState(null);
        useEffect(() => {
          setLoading(true);
          (async () => {
            const result = await fetchResults(query);
            setData(result);
            setLoading(false);
          })();
        }, [query]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a DOM measurement re-triggered by a prop", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Box({ visible }) {
        const ref = useRef(null);
        const [mobile, setMobile] = useState(false);
        useEffect(() => {
          if (ref.current) setMobile(ref.current.offsetWidth < 600);
        }, [visible]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the measurement is stored in a local before the setter (nexu-io AvatarMenu)", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function AvatarMenu({ open }) {
        const anchorRef = useRef(null);
        const [popoverStyle, setPopoverStyle] = useState(null);
        useEffect(() => {
          const updatePosition = () => {
            const node = anchorRef.current;
            if (!node) return;
            const rect = node.getBoundingClientRect();
            const top = rect.bottom + 8;
            const available = Math.max(160, window.innerHeight - top - 12);
            setPopoverStyle({ position: "fixed", top, maxHeight: Math.min(520, available) });
          };
          updatePosition();
          window.addEventListener("resize", updatePosition);
          return () => window.removeEventListener("resize", updatePosition);
        }, [open]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on the initial-sync call of a subscription effect (appflowy awareness selector)", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function useAwarenessUsers({ awareness }) {
        const [users, setUsers] = useState([]);
        useEffect(() => {
          const renderUsers = () => {
            setUsers(collectStates(awareness));
          };
          awareness.on("change", renderUsers);
          renderUsers();
          return () => awareness.off("change", renderUsers);
        }, [awareness]);
        return users;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on the reset branch of a scroll-subscription effect (cloudscape use-token-mode)", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Tokens({ items }) {
        const [triggerVisible, setTriggerVisible] = useState(true);
        useEffect(() => {
          setTriggerVisible(true);
          const onScroll = () => {
            setTriggerVisible(computeVisibility());
          };
          window.addEventListener("scroll", onScroll, true);
          return () => window.removeEventListener("scroll", onScroll, true);
        }, [items]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a module-constant reset inside an async fetch effect (psysonic useShareQueuePreview)", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `const IDLE = { status: "idle" };
      function useShareQueuePreview({ open, payload }) {
        const [state, setState] = useState(IDLE);
        useEffect(() => {
          if (!open || !payload) {
            setState(IDLE);
            return;
          }
          let cancelled = false;
          setState({ status: "loading" });
          resolvePayload(payload).then((result) => {
            if (!cancelled) setState({ status: "ok", songs: result.songs });
          });
          return () => {
            cancelled = true;
          };
        }, [open, payload]);
        return state;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a literal-merge functional updater beside an async setter (loading toggle)", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Results({ query }) {
        const [response, setResponse] = useState({ loading: false, items: [] });
        useEffect(() => {
          setResponse((prev) => ({ ...prev, loading: true, error: false }));
          fetchItems(query).then((items) => {
            setResponse({ loading: false, items });
          });
        }, [query]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports an immutable module-constant reset with no external work", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `const EMPTY = { items: [] };
      function List({ source }) {
        const [bucket, setBucket] = useState(EMPTY);
        useEffect(() => {
          setBucket(EMPTY);
        }, [source]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a prop-keyed constant reset inside memo and forwardRef", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `const VideoBlock = memo(forwardRef(({ url }, ref) => {
        const [error, setError] = useState(undefined);
        useEffect(() => {
          setError(undefined);
        }, [url]);
        return null;
      }));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on a timer-driven two-phase transition", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Sheet({ isOpen }) {
        const [isAnimating, setIsAnimating] = useState(false);
        useEffect(() => {
          setIsAnimating(true);
          const timer = setTimeout(() => setIsAnimating(false), 300);
          return () => clearTimeout(timer);
        }, [isOpen]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  describe("delta audit vs 0.7.1", () => {
    it("stays silent on an object-URL lifecycle effect with revoke cleanup (mezzanine UploadPictureCard)", () => {
      const result = runRule(
        noAdjustStateOnPropChange,
        `const UploadPictureCard = forwardRef(function UploadPictureCard({ file, url, isImage }, ref) {
          const [imageUrl, setImageUrl] = useState('');
          useEffect(() => {
            if (url && isImage) {
              setImageUrl(url);
              return undefined;
            }
            if (file && isImage) {
              try {
                const blobUrl = URL.createObjectURL(file);
                setImageUrl(blobUrl);
                return () => {
                  URL.revokeObjectURL(blobUrl);
                };
              } catch (error) {
                setImageUrl('');
              }
            } else {
              setImageUrl('');
            }
            return undefined;
          }, [file, url, isImage]);
          return null;
        });`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on a batch object-URL preview map with revoke cleanup (open-design HomeHero)", () => {
      const result = runRule(
        noAdjustStateOnPropChange,
        `function HomeHero({ stagedFiles }) {
          const [stagedFilePreviewUrls, setStagedFilePreviewUrls] = useState(new Map());
          useEffect(() => {
            const urls = new Map();
            stagedFiles.forEach((file, index) => {
              if (isImageFile(file)) urls.set(homeFileKey(file, index), URL.createObjectURL(file));
            });
            setStagedFilePreviewUrls(urls);
            return () => {
              urls.forEach((url) => URL.revokeObjectURL(url));
            };
          }, [stagedFiles]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on a readiness latch whose deps are local state seeded from a prop (mezzanine CropperElement)", () => {
      const result = runRule(
        noAdjustStateOnPropChange,
        `const CropperElement = forwardRef(function CropperElement({ initialCropArea, src }, ref) {
          const [cropArea, setCropArea] = useState(initialCropArea || null);
          const [imageLoaded, setImageLoaded] = useState(false);
          const [initReady, setInitReady] = useState(false);
          const lastCanvasSizeRef = useRef(null);
          useEffect(() => {
            if (!imageLoaded || !cropArea) return;
            if (!lastCanvasSizeRef.current) return;
            setInitReady(true);
          }, [cropArea, imageLoaded]);
          return null;
        });`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on async loading lifecycle behind a scheduler wrapper with cancellation cleanup (freecut compound-clip-waveform)", () => {
      const result = runRule(
        noAdjustStateOnPropChange,
        `function CompoundClipWaveform({ isVisible, mediaIds, sourceDuration }) {
          const [waveformsByMediaId, setWaveformsByMediaId] = useState(new Map());
          const [isLoading, setIsLoading] = useState(false);
          const [hasError, setHasError] = useState(false);
          const requestTokenRef = useRef(0);
          useEffect(() => {
            requestTokenRef.current += 1;
            const requestToken = requestTokenRef.current;
            if (!isVisible || mediaIds.length === 0) {
              setWaveformsByMediaId(new Map());
              setIsLoading(false);
              setHasError(false);
              return;
            }
            let cancelled = false;
            setIsLoading(true);
            setHasError(false);
            const cancelScheduledStart = schedulePreviewWork(() => {
              void Promise.allSettled(
                mediaIds.map(async (mediaId) => {
                  const blobUrl = await resolveMediaUrl(mediaId);
                  return [mediaId, blobUrl];
                }),
              ).then((results) => {
                if (cancelled || requestToken !== requestTokenRef.current) return;
                setWaveformsByMediaId(new Map(results));
                setHasError(false);
                setIsLoading(false);
              });
            });
            return () => {
              cancelled = true;
              cancelScheduledStart();
            };
          }, [isVisible, mediaIds, sourceDuration]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("reports a constant reset keyed on a prop dependency", () => {
      const result = runRule(
        noAdjustStateOnPropChange,
        `function List({ items }) {
          const [selection, setSelection] = useState(null);
          useEffect(() => {
            setSelection(null);
          }, [items]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("stays silent on a nested two-phase timer toggle", () => {
      const result = runRule(
        noAdjustStateOnPropChange,
        `function Sheet({ isOpen }) {
          const [isAnimating, setIsAnimating] = useState(false);
          useEffect(() => {
            setIsAnimating(true);
            const cancel = scheduleWork(() => {
              setTimeout(() => setIsAnimating(false), 300);
            });
            return () => cancel();
          }, [isOpen]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("docs-validation round 2", () => {
    it("stays silent on an async probe whose on* handler assignments set the same state (psysonic artistHero)", () => {
      const result = runRule(
        noAdjustStateOnPropChange,
        `function ArtistHeroCover({ artistInfo }) {
          const [externalUrl, setExternalUrl] = useState('');
          const [externalFailed, setExternalFailed] = useState(false);
          const candidateUrl = artistInfo?.largeImageUrl ?? '';
          useEffect(() => {
            setExternalFailed(false);
            setExternalUrl('');
            if (!candidateUrl) return;
            let cancelled = false;
            const probe = new Image();
            probe.onload = () => { if (!cancelled) setExternalUrl(candidateUrl); };
            probe.onerror = () => { if (!cancelled) setExternalFailed(true); };
            probe.src = candidateUrl;
            return () => { cancelled = true; };
          }, [candidateUrl]);
          return externalUrl;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on a sync constant reset when an external handler sets other state", () => {
      const result = runRule(
        noAdjustStateOnPropChange,
        `function Cover({ url }) {
          const [failed, setFailed] = useState(false);
          const [cleared, setCleared] = useState(false);
          useEffect(() => {
            setCleared(false);
            const probe = new Image();
            probe.onerror = () => setFailed(true);
            probe.src = url;
          }, [url]);
          return failed || cleared;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });
});
