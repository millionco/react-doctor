/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {describe, expect, it} from 'vite-plus/test';
import {verifySource} from '../../verify';

const hasFinding = (
  report: ReturnType<typeof verifySource>,
  property: string,
): boolean => report.findings.some((finding) => finding.property === property);

describe('family · Rules of Hooks', () => {
  it('VIOLATION: hook called conditionally', () => {
    const report = verifySource(`
      import {useState} from 'react';
      function Widget({enabled}) {
        if (enabled) {
          const [x, setX] = useState(0);
          return <div>{x}</div>;
        }
        return null;
      }
    `);
    expect(hasFinding(report, 'no-conditional-hook')).toBe(true);
  });

  it('SAFE: hooks called unconditionally', () => {
    const report = verifySource(`
      import {useState} from 'react';
      function Widget({enabled}) {
        const [x, setX] = useState(0);
        return enabled ? <div>{x}</div> : null;
      }
    `);
    expect(hasFinding(report, 'no-conditional-hook')).toBe(false);
  });
});

describe('family · Render purity', () => {
  it('VIOLATION: reads ref.current during render', () => {
    const report = verifySource(`
      import {useRef} from 'react';
      function Widget() {
        const ref = useRef(0);
        return <div>{ref.current}</div>;
      }
    `);
    expect(hasFinding(report, 'no-ref-read-in-render')).toBe(true);
  });

  it('SAFE: ref read inside an effect, not render', () => {
    const report = verifySource(`
      import {useRef, useEffect} from 'react';
      function Widget() {
        const ref = useRef(0);
        useEffect(() => {
          console.log(ref.current);
        }, []);
        return <div />;
      }
    `);
    expect(hasFinding(report, 'no-ref-read-in-render')).toBe(false);
  });
});

describe('family · Effect correctness', () => {
  it('FINDING: subscription with no cleanup', () => {
    const report = verifySource(`
      import {useEffect} from 'react';
      function Widget() {
        useEffect(() => {
          window.addEventListener('resize', onResize);
        }, []);
        return <div />;
      }
    `);
    expect(hasFinding(report, 'effect-missing-cleanup')).toBe(true);
  });

  it('SAFE: subscription with a cleanup function', () => {
    const report = verifySource(`
      import {useEffect} from 'react';
      function Widget() {
        useEffect(() => {
          window.addEventListener('resize', onResize);
          return () => window.removeEventListener('resize', onResize);
        }, []);
        return <div />;
      }
    `);
    expect(hasFinding(report, 'effect-missing-cleanup')).toBe(false);
  });
});

describe('family · Cross-component cascade', () => {
  it('FINDING: fresh object prop to a child component', () => {
    const report = verifySource(`
      function Widget({items}) {
        return <Child style={{margin: 0}} data={items} />;
      }
    `);
    expect(hasFinding(report, 'no-unstable-jsx-prop')).toBe(true);
  });

  it('SAFE: only primitive / stable props', () => {
    const report = verifySource(`
      function Widget({title, items}) {
        return <Child title={title} data={items} />;
      }
    `);
    expect(hasFinding(report, 'no-unstable-jsx-prop')).toBe(false);
  });
});

describe('family · Resource lifecycle', () => {
  it('VIOLATION: timer started during render', () => {
    const report = verifySource(`
      function Widget() {
        setInterval(() => {}, 1000);
        return <div />;
      }
    `);
    expect(hasFinding(report, 'no-resource-in-render')).toBe(true);
  });

  it('SAFE: timer started inside an effect', () => {
    const report = verifySource(`
      import {useEffect} from 'react';
      function Widget() {
        useEffect(() => {
          const id = setInterval(() => {}, 1000);
          return () => clearInterval(id);
        }, []);
        return <div />;
      }
    `);
    expect(hasFinding(report, 'no-resource-in-render')).toBe(false);
  });
});
