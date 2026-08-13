// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/jsx_key.rs`
// Each entry is a verbatim port of an OXC `pass`/`fail` vec entry.
// `oxcOptions` (optional) is OXC's first config arg (`Some(json!([…]))`),
// preserved as JS for tests that want to translate it. `oxcSettings`
// (optional) mirrors the third tuple slot used for plugin settings.

export interface OxcFixture {
  code: string;
  oxcOptions?: unknown;
  oxcSettings?: unknown;
  oxcFilename?: string;
}

export const passCases: ReadonlyArray<OxcFixture> = [
  { code: `fn()` },
  { code: `[1, 2, 3].map(function () {})` },
  { code: `<App />;` },
  { code: `[<App key={0} />, <App key={1} />];` },
  { code: `[1, 2, 3].map(function(x) { return <App key={x} /> });` },
  { code: `[1, 2, 3].map(x => <App key={x} />);` },
  { code: `[1, 2 ,3].map(x => x && <App x={x} key={x} />);` },
  { code: `[1, 2 ,3].map(x => x ? <App x={x} key="1" /> : <OtherApp x={x} key="2" />);` },
  { code: `[1, 2, 3].map(x => { return <App key={x} /> });` },
  { code: `Array.from([1, 2, 3], function(x) { return <App key={x} /> });` },
  { code: `Array.from([1, 2, 3], (x => <App key={x} />));` },
  { code: `Array.from([1, 2, 3], (x => {return <App key={x} />}));` },
  { code: `Array.from([1, 2, 3], someFn);` },
  { code: `Array.from([1, 2, 3]);` },
  { code: `[1, 2, 3].foo(x => <App />);` },
  { code: `var App = () => <div />;` },
  { code: `[1, 2, 3].map(function(x) { return; });` },
  { code: `foo(() => <div />);` },
  { code: `foo(() => <></>);` },
  { code: `<></>;` },
  { code: `<App {...{}} />;` },
  {
    code: `<App key="keyBeforeSpread" {...{}} />;`,
    oxcOptions: [{ checkKeyMustBeforeSpread: true }],
  },
  {
    code: `<div key="keyBeforeSpread" {...{}} />;`,
    oxcOptions: [{ checkKeyMustBeforeSpread: true }],
  },
  {
    code: `
        const spans = [
            <span key="notunique"/>,
            <span key="notunique"/>,
        ];
        `,
  },
  {
    code: `
        function Component(props) {
            return hasPayment ? (
            <div className="stuff">
                <BookingDetailSomething {...props} />
                {props.modal && props.calculatedPrice && (
                <SomeOtherThing items={props.something} discount={props.discount} />
                )}
            </div>
            ) : null;
        }
        `,
  },
  {
    code: `
        import React, { FC, useRef, useState } from 'react';

        import './ResourceVideo.sass';
        import VimeoVideoPlayInModal from '../vimeoVideoPlayInModal/VimeoVideoPlayInModal';

        type Props = {
            videoUrl: string;
            videoTitle: string;
        };
        const ResourceVideo: FC<Props> = ({
            videoUrl,
            videoTitle,
        }: Props): JSX.Element => {
            return (
            <div className="resource-video">
                <VimeoVideoPlayInModal videoUrl={videoUrl} />
                <h3>{videoTitle}</h3>
            </div>
            );
        };

        export default ResourceVideo;
        `,
  },
  {
    code: `
        // testrule.jsx
        const trackLink = () => {};
        const getAnalyticsUiElement = () => {};

        const onTextButtonClick = (e, item) => trackLink([, getAnalyticsUiElement(item), item.name], e);
        `,
  },
  {
    code: `
        function Component({ allRatings }) {
            return (
            <RatingDetailsStyles>
                {Object.entries(allRatings)?.map(([key, value], index) => {
                const rate = value?.split(/(?=[%, /])/);

                if (!rate) return null;

                return (
                    <li key={\`\${entertainment.tmdbId}\${index}\`}>
                    <img src={\`/assets/rating/\${key}.png\`} />
                    <span className="rating-details--rate">{rate?.[0]}</span>
                    <span className="rating-details--rate-suffix">{rate?.[1]}</span>
                    </li>
                );
                })}
            </RatingDetailsStyles>
            );
        }
        `,
  },
  {
    code: `
        const baz = foo?.bar?.()?.[1] ?? 'qux';

        qux()?.map()

        const directiveRanges = comments?.map(tryParseTSDirective)
        `,
  },
  {
    code: `
        import { observable } from "mobx";

        export interface ClusterFrameInfo {
            frameId: number;
            processId: number;
        }

        export const clusterFrameMap = observable.map<string, ClusterFrameInfo>();
        `,
  },
  { code: `React.Children.toArray([1, 2 ,3].map(x => <App />));` },
  {
    code: `import { Children } from "react";
            Children.toArray([1, 2 ,3].map(x => <App />));`,
  },
  {
    code: `import Act from 'react';
          import { Children as ReactChildren } from 'react';

          const { Children } = Act;
          const { toArray } = Children;

          Act.Children.toArray([1, 2 ,3].map(x => <App />));
          Act.Children.toArray(Array.from([1, 2 ,3], x => <App />));
          Children.toArray([1, 2 ,3].map(x => <App />));
          Children.toArray(Array.from([1, 2 ,3], x => <App />));
          // ReactChildren.toArray([1, 2 ,3].map(x => <App />));
          // ReactChildren.toArray(Array.from([1, 2 ,3], x => <App />));
          // toArray([1, 2 ,3].map(x => <App />));
          // toArray(Array.from([1, 2 ,3], x => <App />));
          `,
    oxcSettings: { settings: { react: { pragma: "Act", fragment: "Frag" } } },
  },
  { code: `[1, 2, 3].map(x => { return x && <App key={x} />; });` },
  { code: `[1, 2, 3].map(x => { return x && y && <App key={x} />; });` },
  { code: `[1, 2, 3].map(x => { return x && foo(); });` },
  {
    code: `[1, 2, 3].map((item) => {
            return item === 'bar' ? <div key={item}>{item}</div> : <span key={item}>{item}</span>;
          })`,
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `[<App />];` },
  { code: `[<App {...key} />];` },
  { code: `[<App key={0}/>, <App />];` },
  { code: `[1, 2 ,3].map(function(x) { return <App /> });` },
  { code: `[1, 2 ,3].map(x => <App />);` },
  { code: `[1, 2 ,3].map(x => x && <App x={x} />);` },
  { code: `[1, 2 ,3].map(x => x ? <App x={x} key="1" /> : <OtherApp x={x} />);` },
  { code: `[1, 2 ,3].map(x => x ? <App x={x} /> : <OtherApp x={x} key="2" />);` },
  { code: `[1, 2 ,3].map(x => { return <App /> });` },
  { code: `Array.from([1, 2 ,3], function(x) { return <App /> });` },
  { code: `Array.from([1, 2 ,3], (x => { return <App /> }));` },
  { code: `Array.from([1, 2 ,3], (x => <App />));` },
  { code: `[1, 2, 3]?.map(x => <BabelEslintApp />)` },
  { code: `[1, 2, 3]?.map(x => <TypescriptEslintApp />)` },
  {
    code: `[1, 2, 3].map(x => <>{x}</>);`,
    oxcOptions: [{ checkFragmentShorthand: true }],
    oxcSettings: { settings: { react: { pragma: "Act", fragment: "Frag" } } },
  },
  {
    code: `[<></>];`,
    oxcOptions: [{ checkFragmentShorthand: true }],
    oxcSettings: { settings: { react: { pragma: "Act", fragment: "Frag" } } },
  },
  {
    code: `[<App {...obj} key="keyAfterSpread" />];`,
    oxcOptions: [{ checkKeyMustBeforeSpread: true }],
    oxcSettings: { settings: { react: { pragma: "Act", fragment: "Frag" } } },
  },
  {
    code: `[<div {...obj} key="keyAfterSpread" />];`,
    oxcOptions: [{ checkKeyMustBeforeSpread: true }],
    oxcSettings: { settings: { react: { pragma: "Act", fragment: "Frag" } } },
  },
  {
    code: `
                    const spans = [
                      <span key="notunique"/>,
                      <span key="notunique"/>,
                    ];
                  `,
    oxcOptions: [{ warnOnDuplicates: true }],
  },
  {
    code: `
                    const div = (
                      <div>
                        <span key="notunique"/>
                        <span key="notunique"/>
                      </div>
                    );
                  `,
    oxcOptions: [{ warnOnDuplicates: true }],
  },
  {
    code: `
                    const Test = () => {
                      const list = [1, 2, 3, 4, 5];

                      return (
                        <div>
                          {list.map(item => {
                            if (item < 2) {
                              return <div>{item}</div>;
                            }

                            return <div />;
                          })}
                        </div>
                      );
                    };
                  `,
  },
  {
    code: `
                    const TestO = () => {
                      const list = [1, 2, 3, 4, 5];

                      return (
                        <div>
                          {list.map(item => {
                            if (item < 2) {
                              return <div>{item}</div>;
                            } else if (item < 5) {
                              return <div></div>
                            }  else {
                              return <div></div>
                            }

                            return <div />;
                          })}
                        </div>
                      );
                    };
                  `,
  },
  {
    code: `
                    const TestCase = () => {
                      const list = [1, 2, 3, 4, 5];

                      return (
                        <div>
                          {list.map(item => {
                            if (item < 2) return <div>{item}</div>;
                            else if (item < 5) return <div />;
                            else return <div />;
                          })}
                        </div>
                      );
                    };
                  `,
  },
  {
    code: `
                    const TestCase = () => {
                      const list = [1, 2, 3, 4, 5];

                      return (
                        <div>
                          {list.map(x => <div {...spread} key={x} />)}
                        </div>
                      );
                    };
                  `,
    oxcOptions: [{ checkKeyMustBeforeSpread: true }],
  },
  { code: `[1, 2, 3].map(x => { return x && <App />; });` },
  { code: `[1, 2, 3].map(x => { return x || y || <App />; });` },
  {
    code: `[1, 2, 3].map((item) => {
               return item === 'bar' ? <div>{item}</div> : <span>{item}</span>;
             })`,
  },
  {
    code: `[1, 2, 3].map(function(item) {
               return item === 'bar' ? <div>{item}</div> : <span>{item}</span>;
             })`,
  },
  {
    code: `Array.from([1, 2, 3], (item) => {
               return item === 'bar' ? <div>{item}</div> : <span>{item}</span>;
             })`,
  },
  {
    code: `import { Fragment } from 'react';

             const ITEMS = ['bar', 'foo'];

             export default function BugIssue() {
               return (
                 <Fragment>
                   {ITEMS.map((item) => {
                     return item === 'bar' ? <div>{item}</div> : <span>{item}</span>;
                   })}
                 </Fragment>
               );
             }`,
  },
];
