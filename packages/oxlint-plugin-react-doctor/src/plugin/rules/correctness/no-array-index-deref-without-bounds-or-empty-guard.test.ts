import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexDerefWithoutBoundsOrEmptyGuard } from "./no-array-index-deref-without-bounds-or-empty-guard.js";

describe("no-array-index-deref-without-bounds-or-empty-guard", () => {
  it("flags a regex exec result indexed and dereferenced", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const version = /v(\\d+)/.exec(input)[1].trim();`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a string match result indexed and dereferenced", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const first = raw.match(/(\\w+)/)[1].toLowerCase();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags touches[0] deref inside a touchend addEventListener handler", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `element.addEventListener('touchend', (event) => { const y = event.touches[0].clientY; });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags touches[0] deref inside an onTouchEnd JSX handler", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const el = <div onTouchEnd={(event) => setY(event.touches[0].clientY)} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags .split(delim)[k] for k >= 1 dereferenced", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const ext = fileName.split('.')[1].toUpperCase();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an arithmetic index into a parameter array (caller invariants dominate on real code)", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `function goTo(views, activeViewIndex) { return views[activeViewIndex - 1].id; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the previous-item map idiom guarded by an index > 0 check", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `function List({ items }) {
        return items.map((item, index) => (
          <Row key={item.id} previous={index > 0 ? items[index - 1].label : null} />
        ));
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a reduce accumulator arithmetic deref under an index === 0 ternary (algolia idiom)", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const totals = values.reduce((acc, value, index) => {
        acc.push(index === 0 ? value : acc[index - 1].sum + value);
        return acc;
      }, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a virtualized-grid cellRenderer deref backed by columnCount invariants (dtale idiom)", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const cellRenderer = ({ columnIndex, columns }) => {
        if (columnIndex === 0) return null;
        return <div>{columns[columnIndex - 1].name}</div>;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a delta computed in a map callback under an outer length early return", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `function Chart(points) {
        if (points.length < 2) return null;
        return points.map((p, i) => (i === 0 ? 0 : p.y - points[i - 1].y));
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag .split(delim)[0]", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const host = url.split('://')[0].toLowerCase();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an includes()-guarded split (delimiter presence guarantees the part)", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `if (line.includes(':')) { const value = line.split(':')[1].trim(); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a split in the missing-delimiter branch", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `if (!line.includes(':')) { line.split(':')[1].trim(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a split in the alternate of a missing-delimiter test", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `if (!line.includes(':')) fallback(); else line["split"](':')[1].trim();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a split under a RegExp .test() precondition (rsuite delimiter guard)", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `if (/^\\d+:\\d+$/.test(value)) { const minutes = value.split(':')[1].padStart(2, '0'); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a split guarded by a RegExp .test() over an unrelated value", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `if (/^https:/.test(url)) { const token = header.split(':')[1].trim(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a member-receiver split under a RegExp .test() over the same receiver", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `if (/:/.test(line.text)) { const part = line.text.split(':')[1].trim(); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a split guarded only by an opaque predicate helper", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `function getDecimalLength(value) {
        if (isNumber(value)) {
          return value.toString().split('.')[1].length;
        }
        return 0;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a match deref guarded only by an opaque predicate helper", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const hue = isHexColor(color) ? color.match(/#(\\w+)/)[1].toLowerCase() : null;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a split when the dominating predicate call is over a different value", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `function getDecimalLength(value, other) {
        if (isNumber(other)) {
          return value.toString().split('.')[1].length;
        }
        return 0;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an unconditional member-chain split deref in a hook body (Mern delivery-app shape)", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `function useEditProfileForm() {
        const { currentUser } = useStorage();
        const defaultsValues = {
          city: currentUser.address.split(",")[1].trim(),
        };
        return defaultsValues;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a split on a string literal with a statically guaranteed part count", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const minor = "1.2.3".split(".")[1].padStart(2, "0");`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a string-literal split whose static part count is too short", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const missing = "no-dots".split(".")[1].trim();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag the ternary double-match idiom (test repeats the same match call)", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const v = str.match(/#(\\w+)/) ? str.match(/#(\\w+)/)[1].trim() : '';`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an &&-guarded repeated exec read", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const version = /v(\\d+)/.exec(input) && /v(\\d+)/.exec(input)[1].trim();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a match deref guarded by a DIFFERENT match call", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const v = str.match(/a/) ? str.match(/#(\\w+)/)[1].trim() : '';`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an includes()-guarded split when the delimiter differs", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `if (line.includes(';')) { const value = line.split(':')[1].trim(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag touches[0] inside a touchstart handler", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `element.addEventListener('touchstart', (event) => { startY = event.touches[0].clientY; });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a literal index with a dominating length guard", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `if (invoice.lineItems.length) { const first = invoice.lineItems[0].amount; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a literal index into a local array", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const size = [rect.width, rect.height]; const w = size[0].x;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an optional-chained deref", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const y = event.touches[0]?.clientY;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a runtime-source arithmetic index guarded by a length check", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `function useMenu(items, i) { if (items.length) { return items[i - 1].label; } }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a bare-identifier index into a parameter (object-key ambiguous)", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `function useMenu(items) { return items[selectedIndex].label; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a dynamic object-key read on a reduce accumulator", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `jobs.reduce((acc, job) => { acc[job.teamName] = acc[job.teamName] || []; acc[job.teamName].push(job); return acc; }, {});`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a string-keyed member write on a parameter dictionary", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `function setVar(styles, breakpoint) { styles[breakpoint]['--gap'] = '0px'; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-literal index into a non-parameter local array", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const arr = [1, 2, 3]; const v = arr[selectedIndex].value;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips minified/dist files", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const ext = fileName.split('.')[1].toUpperCase();`,
      { filename: "vendor/lib.min.js" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when touches[0] is guarded by touches.length in a touchend handler", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `element.addEventListener('touchend', (event) => {
         if (event.touches.length > 0) {
           setLastY(event.touches[0].clientY);
         }
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat TouchList truthiness as a non-empty guard", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `element.addEventListener('touchend', (event) => {
         if (event.touches) {
           setLastY(event.touches[0].clientY);
         }
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when a repeated-split length check guards the part read", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const ext = fileName.split('.').length > 1 ? fileName.split('.')[1].toUpperCase() : '';`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when indexOf(delimiter) !== -1 guards the split", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const read = (line) => {
         if (line.indexOf(':') !== -1) {
           return line.split(':')[1].trim();
         }
         return '';
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet after an early-return includes guard inside useMemo", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `function useLabel(raw) {
         return useMemo(() => {
           if (!raw.includes(':')) return '';
           return raw.split(':')[1].trim();
         }, [raw]);
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet after a throw-on-missing-delimiter validation guard", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `function getDomain(email) {
         if (!email.includes('@')) throw new Error('invalid email address');
         return email.split('@')[1].toLowerCase();
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet after an early-return negated match guard with the double-call idiom", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `function extractVersion(input) {
         if (!input.match(/v(\\d+)/)) return null;
         return input.match(/v(\\d+)/)[1].trim();
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet in the ternary alternate after an explicit === null test", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const tag = header.match(/^(\\w+):/) === null ? 'none' : header.match(/^(\\w+):/)[1].toLowerCase();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the deref sits in a map callback over a filtered chain", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `function EnvList({ lines }) {
         return lines
           .filter((line) => line.includes('='))
           .map((line) => <li key={line}>{line.split('=')[1].trim()}</li>);
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags when the filter predicate does not prove the split delimiter", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const rows = lines.filter((line) => line.length > 0).map((line) => line.split('=')[1].trim());`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("supports a statically computed regex method", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const value = /x/["exec"](input)[0].trim();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when the guard is hoisted into a named boolean", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const readHost = (url) => {
         const hasScheme = url.includes('://');
         const host = hasScheme ? url.split('://')[1].split('/')[0] : url;
         return host;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on toISOString().split('T')[1] — the producer guarantees the delimiter", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const time = new Date().toISOString().split('T')[1].replace('Z', '');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust a shadowed Date toISOString method", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `class Date { toISOString() { return "missing"; } }
      const time = new Date().toISOString().split('T')[1].trim();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet on window.location.pathname.split('/')[1]", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const section = window.location.pathname.split('/')[1].toLowerCase();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on an always-matching regex like /^\\s*/ read at [0]", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const indentWidth = line.match(/^\\s*/)[0].length;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when an always-matching regex is anchored at the end", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const lastLinePrefixLength = value.match(/[^\\n]*$/)![0].length;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an unguarded result from a dual-anchored star regex", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const whitespaceLength = value.match(/^\\s*$/)[0].length;
      const stickySuffixLength = value.match(/[^\\n]*$/y)[0].length;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("stays quiet on universal dual-anchored or sticky star regexes", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const dotAllLength = value.match(/^.*$/s)[0].length;
      const everyCharacterLength = value.match(/^[\\s\\S]*$/)[0].length;
      const stickyDotAllLength = value.match(/.*$/ys)[0].length;
      const firstLineLength = value.match(/^[^\\n]*$/m)[0].length;
      const stickyFirstLineLength = value.match(/[^\\r\\n]*$/ym)[0].length;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags String(value) under an opaque predicate", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const decimalPlaces = hasFraction(value) ? String(value).split('.')[1].length : 0;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a props split guarded only by an opaque predicate", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `function Minutes(props) {
         if (isTimeString(props.value)) {
           return <span>{props.value.split(':')[1].padStart(2, '0')}</span>;
         }
         return null;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an unguarded split deref after an unrelated early-return guard", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `function readValue(line, other) {
         if (!other.includes(':')) return '';
         return line.split(':')[1].trim();
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags touches[0] in touchend when the length check reads a different list", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `element.addEventListener('touchend', (event) => {
         if (event.changedTouches.length > 0) {
           setLastY(event.touches[0].clientY);
         }
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a non-anchored specific regex read at [0] without a guard", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const version = line.match(/v\\d+/)[0].slice(1);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a wildcard regex as proof that a literal dot delimiter exists", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `function read(value) {
         if (/./.test(value)) return value.split(".")[1].trim();
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts an escaped literal dot regex as proof of the split delimiter", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `function read(value) {
         if (/\\./.test(value)) return value.split(".")[1].trim();
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a bare indexOf result as a delimiter-presence guard", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `function read(value) {
         if (value.indexOf(".")) return value.split(".")[1].trim();
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an optional regex capture even when the overall match is guarded", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `function read(value) {
         if (value.match(/a(b)?/)) return value.match(/a(b)?/)[1].trim();
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet after an early return on an empty TouchList", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `element.addEventListener("touchend", (event) => {
         if (event.touches.length === 0) return;
         return event.touches[0].clientX;
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an unguarded TouchList read in a named touchend handler", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const handleTouchEnd = (event) => event.touches[0].clientX;
       element.addEventListener("touchend", handleTouchEnd);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a static computed TouchList read", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const C = () => <div onTouchEnd={(event) => event["touches"][0].clientX} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
