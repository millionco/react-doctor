import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireAnimationMixerCleanup } from "./three-require-animation-mixer-cleanup.js";

describe("three-require-animation-mixer-cleanup", () => {
  it("does not require R3F for plain React and Three.js projects", () => {
    expect(threeRequireAnimationMixerCleanup.requires).toBeUndefined();
  });

  it("reports component-owned mixers that cache actions without cleanup", () => {
    const code = `
      import React, { useMemo, useRef } from "react";
      import { AnimationMixer as Mixer } from "three";
      import * as THREE from "three";
      function Direct({ root, clip }) {
        const mixer = new Mixer(root);
        mixer.clipAction(clip);
        return null;
      }
      function Memo({ root, clip }) {
        const mixer = useMemo(() => new THREE.AnimationMixer(root), [root]);
        mixer.clipAction(clip);
        return null;
      }
      function Ref({ root, clip }) {
        const mixerRef = useRef(new Mixer(root));
        mixerRef.current.clipAction(clip);
        return null;
      }
    `;
    expect(runRule(threeRequireAnimationMixerCleanup, code).diagnostics).toHaveLength(3);
  });

  it("accepts stop-before-uncache cleanup with exact root aliases", () => {
    const code = `
      import React, { useEffect, useMemo } from "react";
      import { AnimationMixer } from "three";
      function Scene({ scene, clip }) {
        const ownedRoot = scene;
        const mixer = useMemo(() => new AnimationMixer(ownedRoot), [ownedRoot]);
        const mixerAlias = mixer;
        mixer.clipAction(clip);
        React.useEffect(() => () => {
          mixerAlias.stopAllAction();
          mixerAlias.uncacheRoot(scene);
        }, [mixerAlias]);
        return null;
      }
      function EffectOwned({ root, clip }) {
        useEffect(() => {
          const mixer = new AnimationMixer(root);
          mixer.clipAction(clip);
          return () => {
            mixer.stopAllAction();
            mixer.uncacheRoot(root);
          };
        }, [root, clip]);
        return null;
      }
      function HelperOwned({ root, clip }) {
        const mixer = useMemo(() => new AnimationMixer(root), [root]);
        mixer.clipAction(clip);
        useEffect(() => () => {
          const releaseMixer = () => {
            mixer.stopAllAction();
            mixer.uncacheRoot(root);
          };
          releaseMixer();
        }, [mixer, root]);
        return null;
      }
    `;
    expect(runRule(threeRequireAnimationMixerCleanup, code).diagnostics).toHaveLength(0);
  });

  it("rejects reversed cleanup split across local helpers", () => {
    const code = `
      import { useEffect, useMemo } from "react";
      import { AnimationMixer } from "three";
      function Scene({ root, clip }) {
        const mixer = useMemo(() => new AnimationMixer(root), [root]);
        mixer.clipAction(clip);
        useEffect(() => () => {
          const stopMixer = () => mixer.stopAllAction();
          const uncacheMixer = () => mixer.uncacheRoot(root);
          uncacheMixer();
          stopMixer();
        }, [mixer, root]);
        return null;
      }
    `;
    expect(runRule(threeRequireAnimationMixerCleanup, code).diagnostics).toHaveLength(1);
  });

  it("reports missing, reversed, conditional, and mismatched canonical cleanup", () => {
    const code = `
      import { useEffect, useMemo } from "react";
      import { AnimationMixer } from "three";
      function MissingUncache({ root, clip }) {
        const mixer = useMemo(() => new AnimationMixer(root), [root]);
        mixer.clipAction(clip);
        useEffect(() => () => mixer.stopAllAction(), [mixer]);
        return null;
      }
      function Reversed({ root, clip }) {
        const mixer = useMemo(() => new AnimationMixer(root), [root]);
        mixer.clipAction(clip);
        useEffect(() => () => {
          mixer.uncacheRoot(root);
          mixer.stopAllAction();
        }, [mixer]);
        return null;
      }
      function Conditional({ root, clip, enabled }) {
        const mixer = useMemo(() => new AnimationMixer(root), [root]);
        mixer.clipAction(clip);
        useEffect(() => () => {
          if (enabled) mixer.stopAllAction();
          mixer.uncacheRoot(root);
        }, [mixer, enabled]);
        return null;
      }
      function WrongRoot({ root, otherRoot, clip }) {
        const mixer = useMemo(() => new AnimationMixer(root), [root]);
        mixer.clipAction(clip);
        useEffect(() => () => {
          mixer.stopAllAction();
          mixer.uncacheRoot(otherRoot);
        }, [mixer, otherRoot]);
        return null;
      }
    `;
    expect(runRule(threeRequireAnimationMixerCleanup, code).diagnostics).toHaveLength(4);
  });

  it("keeps fine-grained and multi-root action management quiet", () => {
    const code = `
      import { useEffect, useMemo } from "react";
      import { AnimationMixer } from "three";
      function FineGrained({ root, clip }) {
        const mixer = useMemo(() => new AnimationMixer(root), [root]);
        const action = mixer.clipAction(clip);
        useEffect(() => () => {
          action.stop();
          mixer.uncacheAction(clip, root);
        }, [action, clip, mixer, root]);
        return null;
      }
      function MultiRoot({ root, otherRoot, clip }) {
        const mixer = useMemo(() => new AnimationMixer(root), [root]);
        mixer.clipAction(clip, otherRoot);
        return null;
      }
    `;
    expect(runRule(threeRequireAnimationMixerCleanup, code).diagnostics).toHaveLength(0);
  });

  it("requires a locally proven cached action", () => {
    const code = `
      import { useMemo } from "react";
      import { AnimationMixer } from "three";
      function Scene({ root, clip }) {
        const unused = useMemo(() => new AnimationMixer(root), [root]);
        const queried = useMemo(() => new AnimationMixer(root), [root]);
        queried.existingAction(clip);
        return unused.time + queried.time;
      }
    `;
    expect(runRule(threeRequireAnimationMixerCleanup, code).diagnostics).toHaveLength(0);
  });

  it("stays quiet for unresolved ownership and unsupported provenance", () => {
    const code = `
      import { useMemo } from "react";
      import { AnimationMixer } from "three";
      import { AnimationMixer as InternalMixer } from "three/src/animation/AnimationMixer.js";
      import { AnimationMixer as OtherMixer } from "animation-library";
      const shared = new AnimationMixer(root);
      function Scene({ manager, root, clip }) {
        const adopted = useMemo(() => new AnimationMixer(root), [root]);
        adopted.clipAction(clip);
        manager.adopt(adopted);
        const internal = useMemo(() => new InternalMixer(root), [root]);
        internal.clipAction(clip);
        const other = useMemo(() => new OtherMixer(root), [root]);
        other.clipAction(clip);
        return internal.time + other.time;
      }
    `;
    expect(runRule(threeRequireAnimationMixerCleanup, code).diagnostics).toHaveLength(0);
  });

  it("requires reactive cleanup dependencies to follow the mixer", () => {
    const code = `
      import { useEffect, useMemo } from "react";
      import { AnimationMixer } from "three";
      function Scene({ root, clip }) {
        const mixer = useMemo(() => new AnimationMixer(root), [root]);
        mixer.clipAction(clip);
        useEffect(() => () => {
          mixer.stopAllAction();
          mixer.uncacheRoot(root);
        }, []);
        return null;
      }
    `;
    expect(runRule(threeRequireAnimationMixerCleanup, code).diagnostics).toHaveLength(1);
  });

  it("requires React to own mixer cleanup execution", () => {
    const code = `
      import { useMemo } from "react";
      import { AnimationMixer } from "three";
      function useMixer(root, clip) {
        const mixer = useMemo(() => new AnimationMixer(root), [root]);
        mixer.clipAction(clip);
        return () => {
          mixer.stopAllAction();
          mixer.uncacheRoot(root);
        };
      }
    `;
    expect(runRule(threeRequireAnimationMixerCleanup, code).diagnostics).toHaveLength(1);
  });
});
