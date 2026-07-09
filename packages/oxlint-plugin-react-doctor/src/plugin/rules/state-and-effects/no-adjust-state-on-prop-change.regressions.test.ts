import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

describe("no-adjust-state-on-prop-change — regressions", () => {
  it("ships at warn severity, matching the derived-state family", () => {
    expect(noAdjustStateOnPropChange.severity).toBe("warn");
  });

  it("flags constant resets in a transition effect with a setTimeout sibling (lobe-ui FloatingSheet)", () => {
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
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a literal reset even when the cleanup also calls the setter", () => {
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
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a literal reset beside a timer-callback setter", () => {
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
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a constant setter with no async sibling (upstream invalid shape)", () => {
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

  it("flags a bare .current read on a non-ref data object", () => {
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
    expect(result.diagnostics.length).toBeGreaterThan(0);
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

  it("still flags a constant reset when the effect has no async or subscription flow", () => {
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

  it("flags a prop-keyed constant reset inside a memo(forwardRef(...)) component (appflowy VideoBlock)", () => {
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

  it("still flags a timer-driven two-phase transition (setTimeout is not a subscription)", () => {
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
    expect(result.diagnostics.length).toBeGreaterThan(0);
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

    it("still flags a constant reset keyed on a prop dep even when another effect uses state deps", () => {
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
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it("still flags a two-phase timer toggle even when nested one wrapper deep (no promise flow beneath)", () => {
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
      expect(result.diagnostics.length).toBeGreaterThan(0);
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

    it("still flags a sync reset when the on* handler sets a DIFFERENT state", () => {
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
      expect(result.diagnostics).toHaveLength(1);
    });
  });
});
