import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedState } from "./no-derived-state.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

const cases = [
  {
    name: "native-video-null-ref-direct-readonly-snapshot",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "native-audio-null-ref-direct-snapshot",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLAudioElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <audio ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "same-alias-play-events-and-ready-state",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    const onLoaded = () => { const result = media.play(); if (result !== undefined) result.catch(() => setFailedKey(mediaKey)); }; const onError = () => setFailedKey(mediaKey); media.addEventListener("loadeddata", onLoaded); media.addEventListener("error", onError); if (media.readyState >= 2) onLoaded(); return () => { media.removeEventListener("loadeddata", onLoaded); media.removeEventListener("error", onError); };\n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "forged-current-ref-object",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = { current: { canPlayType: (_mime: string) => "" } };\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "forwarded-prop-ref",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey, mediaRef }: { mime: string; mediaKey: string; mediaRef: { current: HTMLVideoElement | null } }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  \n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "source-current-replacement",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    mediaRef.current = forgedVideo;\n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "custom-tag-ref-target",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <CustomVideo ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "source-canplaytype-override",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    media.canPlayType = (_mime: string) => "";\n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "opaque-media-object-escape",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    observe(media);\n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "opaque-ref-object-escape",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    observe(mediaRef);\n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "returned-media-object-escape",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    return () => expose(media);\n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "extracted-method-escape",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    const selectedMethod = media.canPlayType; observe(selectedMethod);\n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "unknown-receiver-method-call",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    media[methodName]();\n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "duplicate-ref-attribute",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} ref={otherRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "jsx-prop-spread-ref-uncertainty",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} {...attributes} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "two-ref-host-attachments",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <><video ref={mediaRef} /><audio ref={mediaRef} /></>}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "non-media-native-host",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <div ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "pure-prop-derived-control",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (mime === "video/example") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "erased-interface-hidden-ref-writer",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    const replace = () => { interface mediaRef {} mediaRef.current = forgedVideo; }; replace();\n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "dynamic-eval-provider-channel",
    code: 'import { useEffect, useRef, useState } from "react";\nconst invoke = eval; invoke("void 0");\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "ordinary-custom-wrapper-assumption-explicit",
    code: 'import { useEffect, useRef, useState } from "react";\nimport { AnimatePresence } from "motion/react";\nimport { Frame } from "./frame";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <AnimatePresence><Frame><video ref={mediaRef} /></Frame></AnimatePresence>}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "safe-zero-parameter-native-event-and-cleanup",
    code: 'import { useEffect, useRef, useState } from "react";\n\nexport const Example = ({ mime, mediaKey, eventName, observe }: { mime: string; mediaKey: string; eventName: string; observe: (value: unknown) => void }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    const handleError = () => setFailedKey(mediaKey);\n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    media.addEventListener("error", handleError);\n    return () => { media.removeEventListener("error", handleError); };\n  }, [mime, mediaKey, eventName, observe]);\n  return <video ref={mediaRef} data-failed={failedKey === mediaKey} />;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "unknown-native-event-name",
    code: 'import { useEffect, useRef, useState } from "react";\n\nexport const Example = ({ mime, mediaKey, eventName, observe }: { mime: string; mediaKey: string; eventName: string; observe: (value: unknown) => void }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    const handleError = () => setFailedKey(mediaKey);\n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    media.addEventListener(eventName, handleError);\n    return () => { media.removeEventListener(eventName, handleError); };\n  }, [mime, mediaKey, eventName, observe]);\n  return <video ref={mediaRef} data-failed={failedKey === mediaKey} />;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "native-event-options-beyond-profile",
    code: 'import { useEffect, useRef, useState } from "react";\n\nexport const Example = ({ mime, mediaKey, eventName, observe }: { mime: string; mediaKey: string; eventName: string; observe: (value: unknown) => void }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    const handleError = () => setFailedKey(mediaKey);\n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    media.addEventListener("error", handleError, { capture: true });\n    return () => { media.removeEventListener("error", handleError, { capture: true }); };\n  }, [mime, mediaKey, eventName, observe]);\n  return <video ref={mediaRef} data-failed={failedKey === mediaKey} />;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "ordinary-event-function-receiver-channel",
    code: 'import { useEffect, useRef, useState } from "react";\n\nexport const Example = ({ mime, mediaKey, eventName, observe }: { mime: string; mediaKey: string; eventName: string; observe: (value: unknown) => void }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    const handleError = function () { setFailedKey(mediaKey); };\n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    media.addEventListener("error", handleError);\n    return () => { media.removeEventListener("error", handleError); };\n  }, [mime, mediaKey, eventName, observe]);\n  return <video ref={mediaRef} data-failed={failedKey === mediaKey} />;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "parameterized-event-current-target-escape",
    code: 'import { useEffect, useRef, useState } from "react";\n\nexport const Example = ({ mime, mediaKey, eventName, observe }: { mime: string; mediaKey: string; eventName: string; observe: (value: unknown) => void }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    const handleError = (nativeEvent: Event) => { observe(nativeEvent.currentTarget); setFailedKey(mediaKey); };\n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    media.addEventListener("error", handleError);\n    return () => { media.removeEventListener("error", handleError); };\n  }, [mime, mediaKey, eventName, observe]);\n  return <video ref={mediaRef} data-failed={failedKey === mediaKey} />;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "ambient-event-carrier",
    code: 'import { useEffect, useRef, useState } from "react";\n\nexport const Example = ({ mime, mediaKey, eventName, observe }: { mime: string; mediaKey: string; eventName: string; observe: (value: unknown) => void }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    const handleError = () => { observe(event?.currentTarget); setFailedKey(mediaKey); };\n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    media.addEventListener("error", handleError);\n    return () => { media.removeEventListener("error", handleError); };\n  }, [mime, mediaKey, eventName, observe]);\n  return <video ref={mediaRef} data-failed={failedKey === mediaKey} />;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "same-module-secondary-react-provider-escape",
    code: 'import { useEffect, useRef, useState } from "react";\nimport * as React from "react";\nexport const Example = ({ mime, mediaKey, eventName, observe }: { mime: string; mediaKey: string; eventName: string; observe: (value: unknown) => void }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    const handleError = () => setFailedKey(mediaKey);\n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    observe(React); media.addEventListener("error", handleError);\n    return () => { media.removeEventListener("error", handleError); };\n  }, [mime, mediaKey, eventName, observe]);\n  return <video ref={mediaRef} data-failed={failedKey === mediaKey} />;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "snapshot-alias-transport-declines",
    code: 'import { useEffect, useRef, useState } from "react";\n\nexport const Example = ({ mime, mediaKey, eventName, observe }: { mime: string; mediaKey: string; eventName: string; observe: (value: unknown) => void }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    const handleError = () => setFailedKey(mediaKey); const anotherMedia = media;\n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    observe(anotherMedia); media.addEventListener("error", handleError);\n    return () => { media.removeEventListener("error", handleError); };\n  }, [mime, mediaKey, eventName, observe]);\n  return <video ref={mediaRef} data-failed={failedKey === mediaKey} />;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "nonnull-initializer-is-not-host-proof",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(buildMedia());\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "ref-binding-alias-is-not-direct-owner",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  const otherRef = mediaRef;\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = otherRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "mutable-snapshot-declines",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    let media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "unrendered-media-host-declines",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  const unusedHost = <video ref={mediaRef} />;\n  return failedKey;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "jsx-event-target-channel-declines",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} onClick={(event) => observe(event.currentTarget)} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "inherited-quiet-ambient-eval-mask",
    code: 'import { useEffect, useRef, useState } from "react";\ndeclare const eval: (source: string) => unknown;\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    eval("void 0");\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "erased-namespace-provider-mask-declines",
    code: 'import { useEffect, useRef, useState } from "react";\nimport type * as Runtime from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    observe(Runtime);\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "destructured-constructor-channel-declines",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    const { constructor: build } = () => {}; build("void 0")();\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "dynamic-import-declines",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    void import("react");\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "capability-does-not-hide-nearby-prop-copy",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const [copiedKey, setCopiedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    setCopiedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{copiedKey}{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "strict-or-support-result-stays-supported",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    const support = media.canPlayType(mime);\n    if (support === "maybe" || support === "probably") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "parenthesized-snapshot-and-receiver",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = (mediaRef.current);\n    \n    if ((media).canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "readonly-namespace-hook-provider",
    code: 'import * as React from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = React.useState<string | null>(null);\n  const mediaRef = React.useRef<HTMLVideoElement | null>(null);\n  React.useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "same-readonly-mime-guard-with-native-comparison",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    const normalizedMime = mime.trim();\n    if (normalizedMime && media.canPlayType(normalizedMime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "opaque-left-conjunction-declines",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    const normalizedMime = mime.trim();\n    if (observe(normalizedMime) && media.canPlayType(normalizedMime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "member-left-conjunction-declines",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    const normalizedMime = mime.trim();\n    if (settings.normalizedMime && media.canPlayType(normalizedMime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "different-argument-conjunction-outside-profile",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    const normalizedMime = mime.trim();\n    if (normalizedMime && media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "reassigned-guard-conjunction-declines",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    let normalizedMime = mime.trim(); normalizedMime = mime;\n    if (normalizedMime && media.canPlayType(normalizedMime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    options: {
      filename: "src/components/media-capability-control.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
];

describe.each([noDerivedState, noDerivedStateEffect])(
  "closed native media ref capability",
  (rule) => {
    it.each(cases)("$name", ({ code, options, expected }) => {
      const result = runRule(rule, code, options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expected);
    });
  },
);

describe("closed native media ref prop adjustments", () => {
  it.each([
    {
      name: "native-ref-capability-constant-write",
      code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState(false);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(true);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey ? null : <video ref={mediaRef} />}</>;\n};\n',
      expected: 0,
    },
    {
      name: "forged-ref-constant-write",
      code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState(false);\n  const mediaRef = { current: { canPlayType: () => "" } };\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(true);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey ? null : <video ref={mediaRef} />}</>;\n};\n',
      expected: 1,
    },
    {
      name: "pure-prop-constant-write",
      code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState(false);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (mime) setFailedKey(true);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey ? null : <video ref={mediaRef} />}</>;\n};\n',
      expected: 1,
    },
  ])("$name", ({ code, expected }) => {
    const result = runRule(noAdjustStateOnPropChange, code, cases[0].options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
