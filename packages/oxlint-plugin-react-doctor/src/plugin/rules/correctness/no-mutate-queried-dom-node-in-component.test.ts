import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMutateQueriedDomNodeInComponent } from "./no-mutate-queried-dom-node-in-component.js";

describe("no-mutate-queried-dom-node-in-component", () => {
  it("flags classList.add on a queried class whose className is dynamic", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel({ open }) {
        useEffect(() => {
          document.querySelector('.panel').classList.add('open');
        }, []);
        return <div className={\`panel \${open ? 'open' : ''}\`} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a style mutation on a getElementById result whose style prop drives the same property", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Overlay({ dimmed }) {
        const el = document.getElementById('main-content');
        el.style.filter = 'blur(3px)';
        return <section id="main-content" style={{ filter: dimmed ? 'blur(3px)' : 'none' }} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags classList.remove on a queried #id with a dynamic className", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Menu({ locked }) {
        const container = document.querySelector('#right');
        container.classList.remove('noscroll');
        return <aside id="right" className={locked ? 'noscroll' : ''} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a chained getElementById style mutation against a dynamic style prop", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Row({ order }) {
        document.getElementById('row-1').style.zIndex = '1';
        return <div id="row-1" style={{ zIndex: order }} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag mutating a createElement node", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Download() {
        const a = document.createElement('a');
        a.style.display = 'none';
        return <div className="panel" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag setAttribute (not in the mutation set)", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        document.querySelector('.panel').setAttribute('data-x', '1');
        return <div className="panel" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a read-only query call", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        document.getElementById('panel').scrollIntoView();
        return <div id="panel" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag document.body style mutations", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        document.body.style.overflow = 'hidden';
        return <div className="panel" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a ref.current style mutation", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        const ref = useRef(null);
        ref.current.style.color = 'red';
        return <div ref={ref} className="panel" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a selector the component does not render (no ownership link)", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        document.querySelector('.external-widget').classList.add('open');
        return <div className="panel" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag innerHTML (dropped from the mutation set)", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        const el = document.getElementById('x');
        el.innerHTML = html;
        return <div id="x" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a dynamic (non-static) query id", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Row({ rowId }) {
        document.getElementById(rowId).style.zIndex = '1';
        return <div id="row-1" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag mutations outside a component or hook", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function setup() {
        document.querySelector('.panel').classList.add('open');
      }
      const markup = <div className="panel" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a shadowed createElement node whose name matches an owned query var (download-link idiom)", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel({ hidden }) {
        const el = document.getElementById('panel');
        const width = el.offsetWidth;
        const download = () => {
          const el = document.createElement('a');
          el.style.display = 'none';
          document.body.appendChild(el);
        };
        return <div id="panel" style={{ display: hidden ? 'none' : 'block' }} onClick={download} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a callback parameter that shadows an owned query var (helper decorating its own argument)", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function List({ dim }) {
        const item = document.querySelector('.item');
        const top = item.offsetTop;
        const decorate = (item) => {
          item.style.opacity = '0.5';
        };
        return <div className="item" style={{ opacity: dim ? 0.5 : 1 }} onMouseEnter={decorate} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still tracks an owned query binding when an unrelated callback shadows its name", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel({ color, items }) {
         const node = document.getElementById("panel");
         items.map((node) => node.id);
         node.style.color = "red";
         return <div id="panel" style={{ color }} />;
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags the queried node when a nested handler shadows a different name", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel({ dimmed }) {
        const el = document.getElementById('panel');
        el.style.filter = 'blur(3px)';
        const download = () => {
          const link = document.createElement('a');
          link.style.display = 'none';
        };
        return <div id="panel" style={{ filter: dimmed ? 'blur(3px)' : 'none' }} onClick={download} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags style mutation over an owned querySelectorAll forEach callback", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function List({ color }) {
        document.querySelectorAll('.row').forEach((row) => {
          row.style.background = 'red';
        });
        return <div className="row" style={{ background: color }} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags classList mutation inside a for-of over an owned querySelectorAll", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function List({ active }) {
        for (const row of document.querySelectorAll('.row')) {
          row.classList.add('active');
        }
        return <div className={\`row \${active ? 'active' : ''}\`} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag forEach over a selector the component does not render", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function List() {
        document.querySelectorAll('.external-row').forEach((row) => {
          row.style.background = 'red';
        });
        return <div className="row" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags style.setProperty on an owned queried node whose style prop drives the same custom property", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel({ width }) {
        const el = document.getElementById('panel');
        el.style.setProperty('--width', '10px');
        return <div id="panel" style={{ '--width': width }} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag style.setProperty on a ref.current node", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        const ref = useRef(null);
        ref.current.style.setProperty('--width', '10px');
        return <div ref={ref} className="panel" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the excluded #root token even when rendered", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function App() {
        document.getElementById('root').style.overflow = 'hidden';
        return <div id="root" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Print-mode class toggled around synchronous window.print()", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function InvoicePage({ invoice }) {
  const handlePrint = () => {
    const sheet = document.getElementById('invoice-sheet');
    if (!sheet) return;
    sheet.classList.add('print-expanded');
    window.print();
    sheet.classList.remove('print-expanded');
  };
  return (
    <div>
      <button onClick={handlePrint}>Print</button>
      <div id="invoice-sheet">{invoice.total}</div>
    </div>
  );
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Style saved and restored in try/finally around an html2canvas export", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function ChartCard({ data }) {
  const exportPng = async () => {
    const node = document.getElementById('revenue-chart');
    if (!node) return;
    const previousShadow = node.style.boxShadow;
    node.style.boxShadow = 'none';
    try {
      const canvas = await html2canvas(node);
      triggerDownload(canvas.toDataURL('image/png'));
    } finally {
      node.style.boxShadow = previousShadow;
    }
  };
  return (
    <section>
      <div id="revenue-chart">{data.length}</div>
      <button onClick={exportPng}>Export</button>
    </section>
  );
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Synchronous measure with temporary style override then restore", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function ColumnHeader({ onAutoFit }) {
  const autoFitColumn = () => {
    const cell = document.getElementById('col-title');
    if (!cell) return;
    const previousWidth = cell.style.width;
    cell.style.width = 'auto';
    const naturalWidth = cell.getBoundingClientRect().width;
    cell.style.width = previousWidth;
    onAutoFit(naturalWidth);
  };
  return <th id="col-title" onDoubleClick={autoFitColumn}>Title</th>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Portal host rendered by a sibling component, class toggled with balanced effect cleanup", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `export const ModalHost = () => <div id="modal-host" />;

export const Modal = ({ open, children }) => {
  useEffect(() => {
    if (!open) return;
    const host = document.getElementById('modal-host');
    if (!host) return;
    host.classList.add('has-dialog');
    return () => host.classList.remove('has-dialog');
  }, [open]);
  if (!open) return null;
  return createPortal(children, document.getElementById('modal-host'));
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Effect cleanup clearing inline styles a third-party player left behind", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function VideoStage({ src }) {
  useEffect(() => {
    const player = window.jwplayer('video-stage');
    player.setup({ file: src });
    return () => {
      player.remove();
      const stage = document.getElementById('video-stage');
      if (stage) stage.style.cssText = '';
    };
  }, [src]);
  return <div id="video-stage" className="stage" />;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags an unbalanced class add on an owned node with a dynamic className", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Banner({ highlighted }) {
         const highlight = () => {
           const banner = document.getElementById('promo-banner');
           if (!banner) return;
           banner.classList.add('highlighted');
         };
         return <div id="promo-banner" className={highlighted ? 'highlighted' : ''} onMouseEnter={highlight} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a style write that is never restored against a dynamic style prop", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Chart({ emphasized }) {
         const emphasize = () => {
           const node = document.getElementById('chart');
           if (!node) return;
           node.style.border = '2px solid red';
         };
         return <div id="chart" style={{ border: emphasized ? '2px solid red' : 'none' }} onClick={emphasize} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a style write when the element renders no style prop (iframe-loader idiom)", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `const FrameWrapper = ({ componentName }) => {
        const onLoad = () => {
          document.getElementById('iframe-loader').style.display = 'none';
        };
        return (
          <>
            <div id="iframe-loader">Loading ...</div>
            <iframe id="myFrame" onLoad={onLoad} src={componentName} />
          </>
        );
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a transform write to a node with className but no style prop (parallax demo idiom)", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `const Demo = () => {
        const parallax = useParallax((value) => {
          const card = document.getElementById('parallax-card');
          if (card) {
            card.style.transform = \`rotateX(\${value.roll * 20}deg)\`;
          }
        });
        return (
          <section ref={parallax.ref} className='flex min-h-96'>
            <div className='border-border flex h-72 w-56' id='parallax-card' />
          </section>
        );
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a style write to a node the component also holds a ref to (tooltip zero-latency idiom)", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function WorldMapCard({ tooltipEnabled, setTooltipEnabled, tooltipRef }) {
        useEffect(() => {
          const hideTooltip = () => {
            const tooltip = document.getElementById('world-map-tooltip');
            if (tooltip) tooltip.style.opacity = '0';
            setTooltipEnabled(false);
          };
          window.addEventListener('scroll', hideTooltip);
          return () => window.removeEventListener('scroll', hideTooltip);
        }, []);
        return (
          <div
            id="world-map-tooltip"
            ref={tooltipRef}
            style={{ left: 0, top: 0, opacity: tooltipEnabled ? 1 : 0 }}
          />
        );
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a style write when the element's style prop is a static literal object", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        const el = document.getElementById('panel');
        el.style.display = 'none';
        return <div id="panel" style={{ display: 'block' }} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a style write to a property the dynamic style prop does not drive", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel({ width }) {
        const el = document.getElementById('panel');
        el.style.display = 'none';
        return <div id="panel" style={{ width }} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag classList.add when the element's className is a static string", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        useEffect(() => {
          document.querySelector('.panel').classList.add('open');
        }, []);
        return <div className="panel" />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer ownership from JSX rendered by another component", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Controller() {
         document.getElementById("row").style.opacity = "0";
         return <Panel />;
       }
       function Row({ opacity }) { return <div id="row" style={{ opacity }} />; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a shadowed document object as the browser document", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Row({ document, opacity }) {
         document.getElementById("row").style.opacity = "0";
         return <div id="row" style={{ opacity }} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat branch-exclusive opposite class operations as a balanced toggle", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Row({ active }) {
         const row = document.getElementById("row");
         if (active) row.classList.add("active");
         else row.classList.remove("active");
         return <div id="row" className={active ? "active" : ""} />;
       }`,
    );
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it("does not treat an unreachable opposite class operation as a balanced toggle", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Row({ active }) {
         const row = document.getElementById("row");
         if (false) row.classList.remove("active");
         row.classList.add("active");
         return <div id="row" className={active ? "active" : ""} />;
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it("flags opposite class operations when the original class state is unknown", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Row({ active }) {
         const row = document.getElementById("row");
         row.classList.remove("active");
         row.classList.add("active");
         return <div id="row" className={active ? "active" : ""} />;
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it("flags a mutation through an alias of a queried node's style object", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Row({ opacity }) {
         const row = document.getElementById("row");
         const rowStyle = row.style;
         rowStyle.opacity = "0";
         return <div id="row" style={{ opacity }} />;
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes cleanup returned from an aliased React effect hook", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `import { useEffect as useBrowserEffect } from "react";
       function Row({ opacity }) {
         useBrowserEffect(() => {
           return () => {
             const row = document.getElementById("row");
             row.style.opacity = "";
           };
         }, []);
         return <div id="row" style={{ opacity }} />;
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a shadowing local callback runner as a React effect hook", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `import { useEffect as useBrowserEffect } from "react";
       function Row({ opacity, useBrowserEffect }) {
         useBrowserEffect(() => {
           return () => {
             const row = document.getElementById("row");
             row.style.opacity = "";
           };
         });
         return <div id="row" style={{ opacity }} />;
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a restore that happens before the mutation as cleanup", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Row({ opacity }) {
         const row = document.getElementById("row");
         const previousOpacity = row.style.opacity;
         row.style.opacity = previousOpacity;
         row.style.opacity = "0";
         return <div id="row" style={{ opacity }} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a conditional or unreachable later restore as guaranteed cleanup", () => {
    const conditionalResult = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Row({ opacity, shouldRestore }) {
         const row = document.getElementById("row");
         const previousOpacity = row.style.opacity;
         row.style.opacity = "0";
         if (shouldRestore) row.style.opacity = previousOpacity;
         return <div id="row" style={{ opacity }} />;
       }`,
    );
    const unreachableResult = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Row({ opacity }) {
         const row = document.getElementById("row");
         const previousOpacity = row.style.opacity;
         row.style.opacity = "0";
         if (false) row.style.opacity = previousOpacity;
         return <div id="row" style={{ opacity }} />;
       }`,
    );
    expect(conditionalResult.parseErrors).toEqual([]);
    expect(unreachableResult.parseErrors).toEqual([]);
    expect(conditionalResult.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(unreachableResult.diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it("recognizes owned JSX returned by a render-time map callback", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Rows({ items, opacity }) {
         document.getElementById("row").style.opacity = "0";
         return items.map((item) => <div id="row" key={item.id} style={{ opacity }} />);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a static computed classList mutation", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Card({ active }) {
         document.querySelector(".owned").classList["add"]("fixed");
         return <div className={\`owned ${"${active}"}\`} />;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
