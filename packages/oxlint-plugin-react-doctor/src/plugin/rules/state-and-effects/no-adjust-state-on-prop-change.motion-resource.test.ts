import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";
import { noDerivedState } from "./no-derived-state.js";
import { noResetAllStateOnPropChange } from "./no-reset-all-state-on-prop-change.js";

interface MotionResourceCase {
  name: string;
  code: string;
  expectedAdjust: number;
  expectedDerived: number;
  expectedReset: number;
}

const motionResourceCases: readonly MotionResourceCase[] = [
  {
    name: "native-video",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <video src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 0,
    expectedDerived: 0,
    expectedReset: 0,
  },
  {
    name: "native-audio",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <audio src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 0,
    expectedDerived: 0,
    expectedReset: 0,
  },
  {
    name: "native-image",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <img src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 0,
    expectedDerived: 0,
    expectedReset: 0,
  },
  {
    name: "native-link",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <link href={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 0,
    expectedDerived: 0,
    expectedReset: 0,
  },
  {
    name: "native-named-handler",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);
  const markResourceFailure = () => setDidFail(true);
  return <video src={resourceUrl} onError={markResourceFailure} />;
};
`,
    expectedAdjust: 0,
    expectedDerived: 0,
    expectedReset: 0,
  },
  {
    name: "native-wrapper-handler",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);
  const markFailure = (failed) => setDidFail(failed); const handleFailure = () => markFailure(true);
  return <video src={resourceUrl} onError={handleFailure} />;
};
`,
    expectedAdjust: 0,
    expectedDerived: 0,
    expectedReset: 0,
  },
  {
    name: "native-playback-effect",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);
  const playerRef = useRef<HTMLVideoElement>(null);
  useEffect(() => { setDidFail(false); }, [resourceUrl]);
  useEffect(() => { const player = playerRef.current; if (!player) return; player.play().catch(() => setDidFail(true)); }, [resourceUrl]);
  return <video ref={playerRef} src={resourceUrl} />;
};
`,
    expectedAdjust: 0,
    expectedDerived: 0,
    expectedReset: 0,
  },
  {
    name: "native-resource-key-reconcile",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(null);

  useEffect(() => { setDidFail((previousFailure) => previousFailure === resourceUrl ? previousFailure : null); }, [resourceUrl]);

  return <video src={resourceUrl} onError={() => setDidFail(resourceUrl)} />;
};
`,
    expectedAdjust: 0,
    expectedDerived: 0,
    expectedReset: 0,
  },
  {
    name: "motion-video-direct",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 0,
    expectedDerived: 0,
    expectedReset: 0,
  },
  {
    name: "motion-video-import-rename",
    code: `import { useState, useEffect, useRef } from "react";
import { motion as animated } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <animated.video src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 0,
    expectedDerived: 0,
    expectedReset: 0,
  },
  {
    name: "motion-video-modern-module",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 0,
    expectedDerived: 0,
    expectedReset: 0,
  },
  {
    name: "motion-audio-direct",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.audio src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 0,
    expectedDerived: 0,
    expectedReset: 0,
  },
  {
    name: "motion-image-direct",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.img src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 0,
    expectedDerived: 0,
    expectedReset: 0,
  },
  {
    name: "motion-video-loaded-data",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onLoadedData={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 0,
    expectedDerived: 0,
    expectedReset: 0,
  },
  {
    name: "motion-video-named-handler",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);
  const markResourceFailure = () => setDidFail(true);
  return <motion.video src={resourceUrl} onError={markResourceFailure} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-resource-key-reconcile",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(null);

  useEffect(() => { setDidFail((previousFailure) => previousFailure === resourceUrl ? previousFailure : null); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={() => setDidFail(resourceUrl)} />;
};
`,
    expectedAdjust: 0,
    expectedDerived: 0,
    expectedReset: 0,
  },
  {
    name: "motion-playback-effect",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);
  const playerRef = useRef<HTMLVideoElement>(null);
  useEffect(() => { setDidFail(false); }, [resourceUrl]);
  useEffect(() => { const player = playerRef.current; if (!player) return; player.play().catch(() => setDidFail(true)); }, [resourceUrl]);
  return <motion.video ref={playerRef} src={resourceUrl} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-create-custom",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
const CustomVideo = (props) => <section {...props} />; const AnimatedVideo = motion.create(CustomVideo);
export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <AnimatedVideo src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-call-custom",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
const CustomVideo = (props) => <section {...props} />; const AnimatedVideo = motion(CustomVideo);
export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <AnimatedVideo src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-local-factory",
    code: `import { useState, useEffect, useRef } from "react";

const motion = { video: (props) => <section {...props} /> };
export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-parameter-shadow",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, motion }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-import-other-library",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "animation-stub";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-import-barrel",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "./animation-barrel";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-type-import",
    code: `import { useState, useEffect, useRef } from "react";
import type { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-inline-type-import",
    code: `import { useState, useEffect, useRef } from "react";
import { type motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-local-factory-alias",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
const animated = motion;
export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <animated.video src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-local-component-alias",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
const AnimatedVideo = motion.video;
export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <AnimatedVideo src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-namespace-import",
    code: `import { useState, useEffect, useRef } from "react";
import * as Motion from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <Motion.motion.video src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-client-namespace",
    code: `import { useState, useEffect, useRef } from "react";
import * as motion from "motion/react-client";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-m-factory",
    code: `import { useState, useEffect, useRef } from "react";
import { m as motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-static-write",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
motion.video = replacementVideo;
export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-dynamic-write",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
motion[chooseProperty()] = replacementVideo;
export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-delete",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
delete motion.video;
export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-reflect-define",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
Object.defineProperty(motion, "video", { value: replacementVideo });
export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-call-escape",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
registerAnimationProvider(motion);
export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-export-escape",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
export { motion };
export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-alias-write",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
const alias = motion; alias.video = replacementVideo;
export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-second-import-write",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion"; import { motion as otherMotion } from "framer-motion";
otherMotion.video = replacementVideo;
export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-namespace-provider-write",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion"; import * as MotionProvider from "framer-motion";
MotionProvider.motion.video = replacementVideo;
export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-overriding-spread",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={() => setDidFail(true)} {...overrides} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-leading-spread",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video {...overrides} src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-overwritten-src",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={() => setDidFail(true)} src={otherUrl} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-overwritten-handler",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={() => setDidFail(true)} onError={externalErrorHandler} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-dynamic-handler",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} {...{ [eventName]: () => setDidFail(true) }} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-external-handler",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={externalErrorHandler} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-unused-handler",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);
  const unusedFailureHandler = () => setDidFail(true);
  return <motion.video src={resourceUrl} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-src-other-dependency",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={otherUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-src-only-label",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={otherUrl} title={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-src-sibling",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <><motion.video src={resourceUrl} /><motion.video src={otherUrl} onError={() => setDidFail(true)} /></>;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-div-tag",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.div src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-invalid-event-for-video",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onLoad={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-click-writer",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onClick={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "motion-draft-state",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState("");

  useEffect(() => { setDidFail(""); }, [resourceUrl]);

  return <><input value={didFail} onChange={(event) => setDidFail(event.target.value)} /><motion.video src={resourceUrl} onError={() => setDidFail("failed")} /></>;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "native-pure-reset",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <video src={resourceUrl} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "native-wrong-resource",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <video src={otherUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "native-wrong-event",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <video src={resourceUrl} onClick={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "native-latch-not-initial-reset",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);

  useEffect(() => { setDidFail(null); }, [resourceUrl]);

  return <video src={resourceUrl} onError={() => setDidFail(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 0,
  },
  {
    name: "motion-two-state-writers",
    code: `import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

export const ResourceCard = ({ resourceUrl, unrelatedKey, otherUrl, overrides }) => {
  const [didFail, setDidFail] = useState(false);
  const [otherFailed, setOtherFailed] = useState(false);
  useEffect(() => { setDidFail(false); }, [resourceUrl]);

  return <motion.video src={resourceUrl} onError={() => setOtherFailed(true)} />;
};
`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 0,
  },
  {
    name: "peer-inline-block",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";

export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);

useEffect(()=>setDidFail(false),[resourceUrl]);

return <motion.video src={resourceUrl} onError={()=>{setDidFail(true);}} />;
};`,
    expectedAdjust: 0,
    expectedDerived: 0,
    expectedReset: 0,
  },
  {
    name: "peer-transparent-src",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";

export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);

useEffect(()=>setDidFail(false),[resourceUrl]);

return <motion.video src={(resourceUrl as string)} onError={()=>setDidFail(true)} />;
};`,
    expectedAdjust: 0,
    expectedDerived: 0,
    expectedReset: 0,
  },
  {
    name: "peer-member-dependency",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";

export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);

useEffect(()=>setDidFail(false),[resourceUrl.label]);

return <motion.video src={resourceUrl} onError={()=>setDidFail(true)} />;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "peer-same-root-other-member",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";

export const PeerResource = (props) => {
const [didFail,setDidFail]=useState(false);
const resourceUrl=props.videoUrl;
useEffect(()=>setDidFail(false),[props.label]);

return <motion.video src={resourceUrl} onError={()=>setDidFail(true)} />;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "peer-same-root-other-alias",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";

export const PeerResource = (props) => {
const [didFail,setDidFail]=useState(false);
const resourceUrl=props.videoUrl; const unrelatedKey=props.label;
useEffect(()=>setDidFail(false),[unrelatedKey]);

return <motion.video src={resourceUrl} onError={()=>setDidFail(true)} />;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "peer-closure-only-src",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";

export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);

useEffect(()=>setDidFail(false),[resourceUrl]);

return <motion.video src={(()=>resourceUrl)} onError={()=>setDidFail(true)} />;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "peer-conditional-other-src",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";

export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);

useEffect(()=>setDidFail(false),[resourceUrl]);

return <motion.video src={resourceUrl ? otherUrl : otherUrl} onError={()=>setDidFail(true)} />;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "peer-resource-binding-reassigned",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";

export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);
resourceUrl=otherUrl;
useEffect(()=>setDidFail(false),[resourceUrl]);

return <motion.video src={resourceUrl} onError={()=>setDidFail(true)} />;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "peer-handler-returns-function",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";

export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);

useEffect(()=>setDidFail(false),[resourceUrl]);

return <motion.video src={resourceUrl} onError={()=>()=>setDidFail(true)} />;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "peer-handler-unused-local",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";

export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);

useEffect(()=>setDidFail(false),[resourceUrl]);

return <motion.video src={resourceUrl} onError={()=>{ const unused=()=>setDidFail(true); }} />;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "peer-handler-deferred",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";

export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);

useEffect(()=>setDidFail(false),[resourceUrl]);

return <motion.video src={resourceUrl} onError={()=>{ schedule(()=>setDidFail(true)); }} />;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "peer-handler-unused-class",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";

export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);

useEffect(()=>setDidFail(false),[resourceUrl]);

return <motion.video src={resourceUrl} onError={()=>{ class Unused { run(){setDidFail(true);} } }} />;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "peer-handler-class-field",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";

export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);

useEffect(()=>setDidFail(false),[resourceUrl]);

return <motion.video src={resourceUrl} onError={()=>{ class Unused { run=()=>setDidFail(true); } }} />;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "peer-handler-setter-shadow",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";

export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);

useEffect(()=>setDidFail(false),[resourceUrl]);

return <motion.video src={resourceUrl} onError={(setDidFail)=>setDidFail(true)} />;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "peer-handler-setter-reassigned",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";

export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);
setDidFail=externalSetter;
useEffect(()=>setDidFail(false),[resourceUrl]);

return <motion.video src={resourceUrl} onError={()=>setDidFail(true)} />;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "peer-provider-cross-module-write",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion"; import {motion as otherMotion} from "motion/react";
otherMotion.video=replacementVideo;
export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);

useEffect(()=>setDidFail(false),[resourceUrl]);

return <motion.video src={resourceUrl} onError={()=>setDidFail(true)} />;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "peer-provider-source-reexport",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";
export {motion as forwardedMotion} from "framer-motion";
export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);

useEffect(()=>setDidFail(false),[resourceUrl]);

return <motion.video src={resourceUrl} onError={()=>setDidFail(true)} />;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "peer-provider-star-reexport",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";
export * from "motion/react";
export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);

useEffect(()=>setDidFail(false),[resourceUrl]);

return <motion.video src={resourceUrl} onError={()=>setDidFail(true)} />;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "peer-provider-dynamic-import",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";
import("framer-motion").then(({motion:otherMotion})=>{otherMotion.video=replacementVideo;});
export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);

useEffect(()=>setDidFail(false),[resourceUrl]);

return <motion.video src={resourceUrl} onError={()=>setDidFail(true)} />;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "peer-provider-require",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";
require("framer-motion").motion.video=replacementVideo;
export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);

useEffect(()=>setDidFail(false),[resourceUrl]);

return <motion.video src={resourceUrl} onError={()=>setDidFail(true)} />;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "peer-provider-for-of-write",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";
for (motion.video of replacementVideos) {}
export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);

useEffect(()=>setDidFail(false),[resourceUrl]);

return <motion.video src={resourceUrl} onError={()=>setDidFail(true)} />;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "peer-provider-destructure-write",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";
({video:motion.video}=replacementProvider);
export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);

useEffect(()=>setDidFail(false),[resourceUrl]);

return <motion.video src={resourceUrl} onError={()=>setDidFail(true)} />;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "peer-provider-class-static-write",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";
class ReplaceProvider {static {motion.video=replacementVideo;}}
export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);

useEffect(()=>setDidFail(false),[resourceUrl]);

return <motion.video src={resourceUrl} onError={()=>setDidFail(true)} />;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "peer-provider-unsafe-closing-reference",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";

export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);

useEffect(()=>setDidFail(false),[resourceUrl]);

return <motion.video src={resourceUrl} onError={()=>setDidFail(true)}><span /></motion.video>;
};`,
    expectedAdjust: 0,
    expectedDerived: 0,
    expectedReset: 0,
  },
  {
    name: "peer-duplicate-unrelated-prop",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";

export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);

useEffect(()=>setDidFail(false),[resourceUrl]);

return <motion.video title="one" title="two" src={resourceUrl} onError={()=>setDidFail(true)}/>;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "peer-ref-only-playback",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";

export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);
const playerRef=useRef(null);
useEffect(()=>setDidFail(false),[resourceUrl]);
useEffect(()=>{playerRef.current?.play().catch(()=>setDidFail(true));},[resourceUrl]);
return <motion.video ref={playerRef} src={resourceUrl}/>;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "peer-sibling-native-ref",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";

export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);
const playerRef=useRef(null);
useEffect(()=>setDidFail(false),[resourceUrl]);
useEffect(()=>{playerRef.current?.play().catch(()=>setDidFail(true));},[resourceUrl]);
return <><motion.video src={resourceUrl}/><video ref={playerRef} src={otherUrl}/></>;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "peer-inline-direct-but-other-resource",
    code: `import {useState,useEffect,useRef} from "react";
import {motion} from "framer-motion";

export const PeerResource = ({resourceUrl,otherUrl,unrelatedKey}) => {
const [didFail,setDidFail]=useState(false);

useEffect(()=>setDidFail(false),[resourceUrl]);

return <><motion.video src={resourceUrl}/><motion.video src={otherUrl} onError={()=>setDidFail(true)}/></>;
};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "collateral-two-motion-latches",
    code: `import {useState,useEffect} from "react";import {motion} from "framer-motion";export const ResourcePair=({resourceUrl,otherUrl})=>{const [didFail,setDidFail]=useState(false);const [secondState,setSecondState]=useState(false);useEffect(()=>{setDidFail(false);setSecondState(false);},[resourceUrl,otherUrl]);return <><motion.video src={resourceUrl} onError={()=>setDidFail(true)}/><motion.video src={otherUrl} onError={()=>setSecondState(true)}/></>;};`,
    expectedAdjust: 0,
    expectedDerived: 0,
    expectedReset: 0,
  },
  {
    name: "collateral-mixed-motion-latch-draft",
    code: `import {useState,useEffect} from "react";import {motion} from "framer-motion";export const ResourcePair=({resourceUrl,otherUrl})=>{const [didFail,setDidFail]=useState(false);const [secondState,setSecondState]=useState("");useEffect(()=>{setDidFail(false);setSecondState("");},[resourceUrl,otherUrl]);return <><motion.video src={resourceUrl} onError={()=>setDidFail(true)}/><input value={secondState} onChange={event=>setSecondState(event.target.value)}/></>;};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "collateral-two-native-latches",
    code: `import {useState,useEffect} from "react";import {motion} from "framer-motion";export const ResourcePair=({resourceUrl,otherUrl})=>{const [didFail,setDidFail]=useState(false);const [secondState,setSecondState]=useState(false);useEffect(()=>{setDidFail(false);setSecondState(false);},[resourceUrl,otherUrl]);return <><video src={resourceUrl} onError={()=>setDidFail(true)}/><video src={otherUrl} onError={()=>setSecondState(true)}/></>;};`,
    expectedAdjust: 0,
    expectedDerived: 0,
    expectedReset: 0,
  },
  {
    name: "collateral-mixed-native-latch-draft",
    code: `import {useState,useEffect} from "react";import {motion} from "framer-motion";export const ResourcePair=({resourceUrl,otherUrl})=>{const [didFail,setDidFail]=useState(false);const [secondState,setSecondState]=useState("");useEffect(()=>{setDidFail(false);setSecondState("");},[resourceUrl,otherUrl]);return <><video src={resourceUrl} onError={()=>setDidFail(true)}/><input value={secondState} onChange={event=>setSecondState(event.target.value)}/></>;};`,
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "false-handler-unrelated-true-writer",
    code: 'import {useState,useEffect} from "react"; import {motion} from "framer-motion"; export const ResourceProbe=({resourceUrl})=>{const [didFail,setDidFail]=useState(false);const unusedWriter=()=>setDidFail(true);useEffect(()=>setDidFail(false),[resourceUrl]);return <motion.video src={resourceUrl} onError={()=>setDidFail(false)}/>;};',
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "resource-destructuring-write",
    code: 'import {useState,useEffect} from "react"; import {motion} from "framer-motion"; export const ResourceProbe=({resourceUrl})=>{const [didFail,setDidFail]=useState(false);({resourceUrl}=replacementResource);useEffect(()=>setDidFail(false),[resourceUrl]);return <motion.video src={resourceUrl} onError={()=>setDidFail(true)}/>;};',
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "resource-update-write",
    code: 'import {useState,useEffect} from "react"; import {motion} from "framer-motion"; export const ResourceProbe=({resourceUrl})=>{const [didFail,setDidFail]=useState(false);resourceUrl++;useEffect(()=>setDidFail(false),[resourceUrl]);return <motion.video src={resourceUrl} onError={()=>setDidFail(true)}/>;};',
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "resource-loop-write",
    code: 'import {useState,useEffect} from "react"; import {motion} from "framer-motion"; export const ResourceProbe=({resourceUrl})=>{const [didFail,setDidFail]=useState(false);for(resourceUrl of otherResources){}useEffect(()=>setDidFail(false),[resourceUrl]);return <motion.video src={resourceUrl} onError={()=>setDidFail(true)}/>;};',
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "setter-destructuring-write",
    code: 'import {useState,useEffect} from "react"; import {motion} from "framer-motion"; export const ResourceProbe=({resourceUrl})=>{const [didFail,setDidFail]=useState(false);({setter:setDidFail}=replacementSetter);useEffect(()=>setDidFail(false),[resourceUrl]);return <motion.video src={resourceUrl} onError={()=>setDidFail(true)}/>;};',
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "provider-require-alias",
    code: 'import {useState,useEffect} from "react"; import {motion} from "framer-motion";const load=require;load("framer-motion").motion.video=replacementVideo; export const ResourceProbe=({resourceUrl})=>{const [didFail,setDidFail]=useState(false);useEffect(()=>setDidFail(false),[resourceUrl]);return <motion.video src={resourceUrl} onError={()=>setDidFail(true)}/>;};',
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "provider-module-require",
    code: 'import {useState,useEffect} from "react"; import {motion} from "framer-motion";module.require("framer-motion").motion.video=replacementVideo; export const ResourceProbe=({resourceUrl})=>{const [didFail,setDidFail]=useState(false);useEffect(()=>setDidFail(false),[resourceUrl]);return <motion.video src={resourceUrl} onError={()=>setDidFail(true)}/>;};',
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "provider-create-require",
    code: 'import {useState,useEffect} from "react"; import {motion} from "framer-motion";import {createRequire as makeLoader} from "node:module";const loader=makeLoader(import.meta.url);loader("framer-motion").motion.video=replacementVideo; export const ResourceProbe=({resourceUrl})=>{const [didFail,setDidFail]=useState(false);useEffect(()=>setDidFail(false),[resourceUrl]);return <motion.video src={resourceUrl} onError={()=>setDidFail(true)}/>;};',
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "provider-module-namespace",
    code: 'import {useState,useEffect} from "react"; import {motion} from "framer-motion";import * as RuntimeModule from "node:module";const loader=RuntimeModule["create"+"Require"](import.meta.url);loader("framer-motion").motion.video=replacementVideo; export const ResourceProbe=({resourceUrl})=>{const [didFail,setDidFail]=useState(false);useEffect(()=>setDidFail(false),[resourceUrl]);return <motion.video src={resourceUrl} onError={()=>setDidFail(true)}/>;};',
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "handler-async",
    code: 'import {useState,useEffect} from "react"; import {motion} from "framer-motion"; export const ResourceProbe=({resourceUrl})=>{const [didFail,setDidFail]=useState(false);useEffect(()=>setDidFail(false),[resourceUrl]);return <motion.video src={resourceUrl} onError={async()=>setDidFail(true)}/>;};',
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "handler-generator",
    code: 'import {useState,useEffect} from "react"; import {motion} from "framer-motion"; export const ResourceProbe=({resourceUrl})=>{const [didFail,setDidFail]=useState(false);useEffect(()=>setDidFail(false),[resourceUrl]);return <motion.video src={resourceUrl} onError={function*(){setDidFail(true);}}/>;};',
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "handler-conditional-write",
    code: 'import {useState,useEffect} from "react"; import {motion} from "framer-motion"; export const ResourceProbe=({resourceUrl})=>{const [didFail,setDidFail]=useState(false);useEffect(()=>setDidFail(false),[resourceUrl]);return <motion.video src={resourceUrl} onError={()=>{if(resourceUrl)setDidFail(true);}}/>;};',
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "repair-repeated-var-resource",
    code: 'import {useState,useEffect} from "react";import {motion} from "framer-motion";export const ResourceStability=(props)=>{var resourceUrl=props.firstUrl;const [didFail,setDidFail]=useState(false);useEffect(()=>setDidFail(false),[resourceUrl]);var resourceUrl=props.otherUrl;return <motion.video src={resourceUrl} onError={()=>setDidFail(true)}/>;};',
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "repair-repeated-var-setter",
    code: 'import {useState,useEffect} from "react";import {motion} from "framer-motion";export const ResourceStability=(props)=>{const resourceUrl=props.resourceUrl;var [didFail,setDidFail]=useState(false);useEffect(()=>setDidFail(false),[resourceUrl]);var setDidFail=props.externalSetter;return <motion.video src={resourceUrl} onError={()=>setDidFail(true)}/>;};',
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "repair-repeated-destructured-var-resource",
    code: 'import {useState,useEffect} from "react";import {motion} from "framer-motion";export const ResourceStability=(props)=>{var resourceUrl=props.firstUrl;const [didFail,setDidFail]=useState(false);useEffect(()=>setDidFail(false),[resourceUrl]);var {otherUrl:resourceUrl}=props;return <motion.video src={resourceUrl} onError={()=>setDidFail(true)}/>;};',
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "repair-repeated-destructured-var-setter",
    code: 'import {useState,useEffect} from "react";import {motion} from "framer-motion";export const ResourceStability=(props)=>{const resourceUrl=props.resourceUrl;var [didFail,setDidFail]=useState(false);useEffect(()=>setDidFail(false),[resourceUrl]);var {externalSetter:setDidFail}=props;return <motion.video src={resourceUrl} onError={()=>setDidFail(true)}/>;};',
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "repair-for-of-var-resource-initialization",
    code: 'import {useState,useEffect} from "react";import {motion} from "framer-motion";export const ResourceStability=(props)=>{var resourceUrl=props.firstUrl;const [didFail,setDidFail]=useState(false);useEffect(()=>setDidFail(false),[resourceUrl]);for(var resourceUrl of props.otherUrls){}return <motion.video src={resourceUrl} onError={()=>setDidFail(true)}/>;};',
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "repair-for-of-var-setter-initialization",
    code: 'import {useState,useEffect} from "react";import {motion} from "framer-motion";export const ResourceStability=(props)=>{const resourceUrl=props.resourceUrl;var [didFail,setDidFail]=useState(false);useEffect(()=>setDidFail(false),[resourceUrl]);for(var [setDidFail] of props.externalSetters){}return <motion.video src={resourceUrl} onError={()=>setDidFail(true)}/>;};',
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "repair-for-in-var-resource-initialization",
    code: 'import {useState,useEffect} from "react";import {motion} from "framer-motion";export const ResourceStability=(props)=>{var resourceUrl=props.firstUrl;const [didFail,setDidFail]=useState(false);useEffect(()=>setDidFail(false),[resourceUrl]);for(var resourceUrl in props.otherUrls){}return <motion.video src={resourceUrl} onError={()=>setDidFail(true)}/>;};',
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "repair-root-late-hoisted-var-resource",
    code: 'import {useState,useEffect} from "react";import {motion} from "framer-motion";export const ResourceStability=(props)=>{const [didFail,setDidFail]=useState(false);useEffect(()=>setDidFail(false),[resourceUrl]);var resourceUrl=props.url;return <motion.video src={resourceUrl} onError={()=>setDidFail(true)}/>;};',
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "repair-readonly-var-outside-v1",
    code: 'import {useState,useEffect} from "react";import {motion} from "framer-motion";export const ResourceStability=(props)=>{var resourceUrl=props.resourceUrl;const [didFail,setDidFail]=useState(false);useEffect(()=>setDidFail(false),[resourceUrl]);return <motion.video src={resourceUrl} onError={()=>setDidFail(true)}/>;};',
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "repair-readonly-let-outside-v1",
    code: 'import {useState,useEffect} from "react";import {motion} from "framer-motion";export const ResourceStability=(props)=>{let resourceUrl=props.resourceUrl;const [didFail,setDidFail]=useState(false);useEffect(()=>setDidFail(false),[resourceUrl]);return <motion.video src={resourceUrl} onError={()=>setDidFail(true)}/>;};',
    expectedAdjust: 1,
    expectedDerived: 0,
    expectedReset: 1,
  },
  {
    name: "repair-const-source-before-effect",
    code: 'import {useState,useEffect} from "react";import {motion} from "framer-motion";export const ResourceStability=(props)=>{const resourceUrl=props.resourceUrl;const [didFail,setDidFail]=useState(false);useEffect(()=>setDidFail(false),[resourceUrl]);return <motion.video src={resourceUrl} onError={()=>setDidFail(true)}/>;};',
    expectedAdjust: 0,
    expectedDerived: 0,
    expectedReset: 0,
  },
  {
    name: "repair-const-destructured-source-before-effect",
    code: 'import {useState,useEffect} from "react";import {motion} from "framer-motion";export const ResourceStability=(props)=>{const {resourceUrl}=props;const [didFail,setDidFail]=useState(false);useEffect(()=>setDidFail(false),[resourceUrl]);return <motion.video src={resourceUrl} onError={()=>setDidFail(true)}/>;};',
    expectedAdjust: 0,
    expectedDerived: 0,
    expectedReset: 0,
  },
];

describe("native Motion resource lifecycle", () => {
  it.each(motionResourceCases)("$name", (fixture) => {
    for (const { rule, expectedCount } of [
      { rule: noAdjustStateOnPropChange, expectedCount: fixture.expectedAdjust },
      { rule: noDerivedState, expectedCount: fixture.expectedDerived },
      { rule: noResetAllStateOnPropChange, expectedCount: fixture.expectedReset },
    ]) {
      const result = runRule(rule, fixture.code, { filename: "resource-card.tsx", forceJsx: true });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics, rule.id).toHaveLength(expectedCount);
    }
  });
});
