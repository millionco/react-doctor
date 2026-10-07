// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/react/exhaustive_deps.rs`
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
  {
    code: `function MyComponent() {
          const local = {};
          useEffect(() => {
            console.log(local);
          });
        }`,
  },
  {
    code: `function MyComponent() {
          useEffect(() => {
            const local = {};
            console.log(local);
          }, []);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = someFunc();
          useEffect(() => {
            console.log(local);
          }, [local]);
        }`,
  },
  {
    code: `function MyComponent() {
          useEffect(() => {
            console.log(props.foo);
          }, []);
        }`,
  },
  {
    code: `function MyComponent() {
          const local1 = {};
          {
            const local2 = {};
            useEffect(() => {
              console.log(local1);
              console.log(local2);
            });
          }
        }`,
  },
  {
    code: `function MyComponent() {
          const local1 = someFunc();
          {
            const local2 = someFunc();
            useCallback(() => {
              console.log(local1);
              console.log(local2);
            }, [local1, local2]);
          }
        }`,
  },
  {
    code: `function MyComponent() {
          const local1 = someFunc();
          function MyNestedComponent() {
            const local2 = someFunc();
            useCallback(() => {
              console.log(local1);
              console.log(local2);
            }, [local2]);
          }
        }`,
  },
  {
    code: `function MyComponent() {
          const local = someFunc();
          useEffect(() => {
            console.log(local);
            console.log(local);
          }, [local]);
        }`,
  },
  {
    code: `function MyComponent() {
          useEffect(() => {
            console.log(unresolved);
          }, []);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = someFunc();
          useEffect(() => {
            console.log(local);
          }, [,,,local,,,]);
        }`,
  },
  {
    code: `function MyComponent({ foo }) {
          useEffect(() => {
            console.log(foo.length);
          }, [foo]);
        }`,
  },
  {
    code: `function MyComponent({ foo }) {
          useEffect(() => {
            console.log(foo.length);
            console.log(foo.slice(0));
          }, [foo]);
        }`,
  },
  {
    code: `function MyComponent({ history }) {
          useEffect(() => {
            return history.listen();
          }, [history]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {});
          useLayoutEffect(() => {});
          useImperativeHandle(props.innerRef, () => {});
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            console.log(props.foo);
          }, [props.foo]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            console.log(props.foo);
            console.log(props.bar);
          }, [props.bar, props.foo]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            console.log(props.foo);
            console.log(props.bar);
          }, [props.foo, props.bar]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          const local = someFunc();
          useEffect(() => {
            console.log(props.foo);
            console.log(props.bar);
            console.log(local);
          }, [props.foo, props.bar, local]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          const local = {};
          useEffect(() => {
            console.log(props.foo);
            console.log(props.bar);
          }, [props, props.foo]);

          let color = someFunc();
          useEffect(() => {
            console.log(props.foo.bar.baz);
            console.log(color);
          }, [props.foo, props.foo.bar.baz, color]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            const { bar } = props.foo;
            console.log(bar);
          }, [props.foo.bar]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            const { foo, bar } = props;
            console.log(foo);
            console.log(bar);
          }, [props]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            const { foo: { bar } } = props;
            console.log(bar);
          }, [props.foo]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            const [bar] = props.foo;
            console.log(bar);
          }, [props.foo]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          const foo = useRef()
          useEffect(() => {
            const { current: bar } = foo;
            console.log(bar);
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          const bar = props.bar;
          useEffect(() => {
            const { bar } = foo();
            console.log(bar);
          }, [props.foo]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            console.log(props.foo?.bar?.baz ?? null);
          }, [props.foo]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            console.log(props.foo);
          }, [props.foo!]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            console.log(props.foo?.bar);
          }, [props.foo.bar]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            console.log(props.foo.bar);
          }, [props.foo?.bar]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            console.log(props.foo.bar);
            console.log(props.foo?.bar);
          }, [props.foo?.bar]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            console.log(props.foo.bar);
            console.log(props.foo?.bar);
          }, [props.foo.bar]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            console.log(props.foo);
            console.log(props.foo?.bar);
          }, [props.foo]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            console.log(props.foo?.toString());
          }, [props.foo]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useMemo(() => {
            console.log(props.foo?.toString());
          }, [props.foo]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useCallback(() => {
            console.log(props.foo?.toString());
          }, [props.foo]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useCallback(() => {
            console.log(props.foo.bar?.toString());
          }, [props.foo.bar]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useCallback(() => {
            console.log(props.foo?.bar?.toString());
          }, [props.foo.bar]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useCallback(() => {
            console.log(props.foo.bar.toString());
          }, [props?.foo?.bar]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useCallback(() => {
            console.log(props.foo?.bar?.baz);
          }, [props?.foo.bar?.baz]);
        }`,
  },
  {
    code: `function MyComponent() {
          const myEffect = () => {
            // Doesn't use anything
          };
          useEffect(myEffect, []);
        }`,
  },
  {
    code: `const local = {};
        function MyComponent() {
          const myEffect = () => {
            console.log(local);
          };
          useEffect(myEffect, []);
        }`,
  },
  {
    code: `const local = {};
        function MyComponent() {
          function myEffect() {
            console.log(local);
          }
          useEffect(myEffect, []);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = someFunc();
          function myEffect() {
            console.log(local);
          }
          useEffect(myEffect, [local]);
        }`,
  },
  {
    code: `function MyComponent() {
          function myEffect() {
            console.log(global);
          }
          useEffect(myEffect, []);
        }`,
  },
  {
    code: `const local = {};
        function MyComponent() {
          const myEffect = () => {
            otherThing()
          }
          const otherThing = () => {
            console.log(local);
          }
          useEffect(myEffect, []);
        }`,
  },
  {
    code: `function MyComponent({delay}) {
          const local = {};
          const myEffect = debounce(() => {
            console.log(local);
          }, delay);
          useEffect(myEffect, [myEffect]);
        }`,
  },
  {
    code: `function MyComponent({myEffect}) {
          useEffect(myEffect, [,myEffect]);
        }`,
  },
  {
    code: `function MyComponent({myEffect}) {
          useEffect(myEffect, [,myEffect,,]);
        }`,
  },
  {
    code: `let local = {};
        function myEffect() {
          console.log(local);
        }
        function MyComponent() {
          useEffect(myEffect, []);
        }`,
  },
  {
    code: `function MyComponent({myEffect}) {
          useEffect(myEffect, [myEffect]);
        }`,
  },
  {
    code: `function MyComponent({myEffect}) {
          useEffect(myEffect);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useCustomEffect(() => {
            console.log(props.foo);
          });
        }`,
  },
  {
    code: `function MyComponent(props) {
          useCustomEffect(() => {
            console.log(props.foo);
          }, [props.foo]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useCustomEffect(() => {
            console.log(props.foo);
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useWithoutEffectSuffix(() => {
            console.log(props.foo);
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          return renderHelperConfusedWithEffect(() => {
            console.log(props.foo);
          }, []);
        }`,
  },
  {
    code: `const local = {};
        useEffect(() => {
          console.log(local);
        }, []);`,
  },
  {
    code: `const local1 = {};
        {
          const local2 = {};
          useEffect(() => {
            console.log(local1);
            console.log(local2);
          }, []);
        }`,
  },
  {
    code: `function MyComponent() {
          const ref = useRef();
          useEffect(() => {
            console.log(ref.current);
          }, [ref]);
        }`,
  },
  {
    code: `function MyComponent() {
          const ref = useRef();
          useEffect(() => {
            console.log(ref.current);
          }, []);
        }`,
  },
  {
    code: `function MyComponent({ maybeRef2, foo }) {
          const definitelyRef1 = useRef();
          const definitelyRef2 = useRef();
          const maybeRef1 = useSomeOtherRefyThing();
          const [state1, setState1] = useState();
          const [state2, setState2] = React.useState();
          const [state3, dispatch1] = useReducer();
          const [state4, dispatch2] = React.useReducer();
          const [state5, maybeSetState] = useFunnyState();
          const [state6, maybeDispatch] = useFunnyReducer();
          const [isPending1] = useTransition();
          const [isPending2, startTransition2] = useTransition();
          const [isPending3] = React.useTransition();
          const [isPending4, startTransition4] = React.useTransition();
          const mySetState = useCallback(() => {}, []);
          let myDispatch = useCallback(() => {}, []);

          useEffect(() => {
            // Known to be static
            console.log(definitelyRef1.current);
            console.log(definitelyRef2.current);
            console.log(maybeRef1.current);
            console.log(maybeRef2.current);
            setState1();
            setState2();
            dispatch1();
            dispatch2();
            startTransition1();
            startTransition2();
            startTransition3();
            startTransition4();

            // Dynamic
            console.log(state1);
            console.log(state2);
            console.log(state3);
            console.log(state4);
            console.log(state5);
            console.log(state6);
            console.log(isPending2);
            console.log(isPending4);
            mySetState();
            myDispatch();

            // Not sure; assume dynamic
            maybeSetState();
            maybeDispatch();
          }, [
            // Dynamic
            state1, state2, state3, state4, state5, state6,
            maybeRef1, maybeRef2,
            isPending2, isPending4,

            // Not sure; assume dynamic
            mySetState, myDispatch,
            maybeSetState, maybeDispatch

            // In this test, we don't specify static deps.
            // That should be okay.
          ]);
        }`,
  },
  {
    code: `function MyComponent({ maybeRef2 }) {
          const definitelyRef1 = useRef();
          const definitelyRef2 = useRef();
          const maybeRef1 = useSomeOtherRefyThing();

          const [state1, setState1] = useState();
          const [state2, setState2] = React.useState();
          const [state3, dispatch1] = useReducer();
          const [state4, dispatch2] = React.useReducer();

          const [state5, maybeSetState] = useFunnyState();
          const [state6, maybeDispatch] = useFunnyReducer();

          const mySetState = useCallback(() => {}, []);
          let myDispatch = useCallback(() => {}, []);

          useEffect(() => {
            // Known to be static
            console.log(definitelyRef1.current);
            console.log(definitelyRef2.current);
            console.log(maybeRef1.current);
            console.log(maybeRef2.current);
            setState1();
            setState2();
            dispatch1();
            dispatch2();

            // Dynamic
            console.log(state1);
            console.log(state2);
            console.log(state3);
            console.log(state4);
            console.log(state5);
            console.log(state6);
            mySetState();
            myDispatch();

            // Not sure; assume dynamic
            maybeSetState();
            maybeDispatch();
          }, [
            // Dynamic
            state1, state2, state3, state4, state5, state6,
            maybeRef1, maybeRef2,

            // Not sure; assume dynamic
            mySetState, myDispatch,
            maybeSetState, maybeDispatch,

            // In this test, we specify static deps.
            // That should be okay too!
            definitelyRef1, definitelyRef2, setState1, setState2, dispatch1, dispatch2
          ]);
        }`,
  },
  {
    code: `const MyComponent = forwardRef((props, ref) => {
          useImperativeHandle(ref, () => ({
            focus() {
              alert(props.hello);
            }
          }))
        });`,
  },
  {
    code: `const MyComponent = forwardRef((props, ref) => {
          useImperativeHandle(ref, () => ({
            focus() {
              alert(props.hello);
            }
          }), [props.hello])
        });`,
  },
  {
    code: `function MyComponent(props) {
          let obj = someFunc();
          useEffect(() => {
            obj.foo = true;
          }, [obj]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          let foo = {}
          useEffect(() => {
            foo.bar.baz = 43;
          }, [foo.bar]);
        }`,
  },
  {
    code: `function MyComponent() {
          const myRef = useRef();
          useEffect(() => {
            const handleMove = () => {};
            myRef.current = {};
            return () => {
              console.log(myRef.current.toString())
            };
          }, []);
          return <div />;
        }`,
  },
  {
    code: `function MyComponent() {
          const myRef = useRef();
          useEffect(() => {
            const handleMove = () => {};
            myRef.current = {};
            return () => {
              console.log(myRef?.current?.toString())
            };
          }, []);
          return <div />;
        }`,
  },
  {
    code: `function useMyThing(myRef) {
          useEffect(() => {
            const handleMove = () => {};
            myRef.current = {};
            return () => {
              console.log(myRef.current.toString())
            };
          }, [myRef]);
        }`,
  },
  {
    code: `function MyComponent() {
          const myRef = useRef();
          useEffect(() => {
            const handleMove = () => {};
            const node = myRef.current;
            node.addEventListener('mousemove', handleMove);
            return () => node.removeEventListener('mousemove', handleMove);
          }, []);
          return <div ref={myRef} />;
        }`,
  },
  {
    code: `function useMyThing(myRef) {
          useEffect(() => {
            const handleMove = () => {};
            const node = myRef.current;
            node.addEventListener('mousemove', handleMove);
            return () => node.removeEventListener('mousemove', handleMove);
          }, [myRef]);
          return <div ref={myRef} />;
        }`,
  },
  {
    code: `function useMyThing(myRef) {
          useCallback(() => {
            const handleMouse = () => {};
            myRef.current.addEventListener('mousemove', handleMouse);
            myRef.current.addEventListener('mousein', handleMouse);
            return function() {
              setTimeout(() => {
                myRef.current.removeEventListener('mousemove', handleMouse);
                myRef.current.removeEventListener('mousein', handleMouse);
              });
            }
          }, [myRef]);
        }`,
  },
  {
    code: `function useMyThing() {
          const myRef = useRef();
          useEffect(() => {
            const handleMove = () => {
              console.log(myRef.current)
            };
            window.addEventListener('mousemove', handleMove);
            return () => window.removeEventListener('mousemove', handleMove);
          }, []);
          return <div ref={myRef} />;
        }`,
  },
  {
    code: `function useMyThing() {
          const myRef = useRef();
          useEffect(() => {
            const handleMove = () => {
              return () => window.removeEventListener('mousemove', handleMove);
            };
            window.addEventListener('mousemove', handleMove);
            return () => {};
          }, []);
          return <div ref={myRef} />;
        }`,
  },
  {
    code: `function MyComponent() {
          const local1 = 42;
          const local2 = '42';
          const local3 = null;
          useEffect(() => {
            console.log(local1);
            console.log(local2);
            console.log(local3);
          }, []);
        }`,
  },
  {
    code: `function MyComponent() {
          const local1 = 42;
          const local2 = '42';
          const local3 = null;
          useEffect(() => {
            console.log(local1);
            console.log(local2);
            console.log(local3);
          }, [local1, local2, local3]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          const local = props.local;
          useEffect(() => {}, [local]);
        }`,
  },
  {
    code: `function Foo({ activeTab }) {
          useEffect(() => {
            window.scrollTo(0, 0);
          }, [activeTab]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            console.log(props.foo.bar.baz);
          }, [props]);
          useEffect(() => {
            console.log(props.foo.bar.baz);
          }, [props.foo]);
          useEffect(() => {
            console.log(props.foo.bar.baz);
          }, [props.foo.bar]);
          useEffect(() => {
            console.log(props.foo.bar.baz);
          }, [props.foo.bar.baz]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          const fn = useCallback(() => {
            console.log(props.foo.bar.baz);
          }, [props]);
          const fn2 = useCallback(() => {
            console.log(props.foo.bar.baz);
          }, [props.foo]);
          const fn3 = useMemo(() => {
            console.log(props.foo.bar.baz);
          }, [props.foo.bar]);
          const fn4 = useMemo(() => {
            console.log(props.foo.bar.baz);
          }, [props.foo.bar.baz]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          function handleNext1() {
            console.log('hello');
          }
          const handleNext2 = () => {
            console.log('hello');
          };
          let handleNext3 = function() {
            console.log('hello');
          };
          useEffect(() => {
            return Store.subscribe(handleNext1);
          }, []);
          useLayoutEffect(() => {
            return Store.subscribe(handleNext2);
          }, []);
          useMemo(() => {
            return Store.subscribe(handleNext3);
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          function handleNext() {
            console.log('hello');
          }
          useEffect(() => {
            return Store.subscribe(handleNext);
          }, []);
          useLayoutEffect(() => {
            return Store.subscribe(handleNext);
          }, []);
          useMemo(() => {
            return Store.subscribe(handleNext);
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          let [, setState] = useState();
          let [, dispatch] = React.useReducer();

          function handleNext1(value) {
            let value2 = value * 100;
            setState(value2);
            console.log('hello');
          }
          const handleNext2 = (value) => {
            setState(foo(value));
            console.log('hello');
          };
          let handleNext3 = function(value) {
            console.log(value);
            dispatch({ type: 'x', value });
          };
          useEffect(() => {
            return Store.subscribe(handleNext1);
          }, []);
          useLayoutEffect(() => {
            return Store.subscribe(handleNext2);
          }, []);
          useMemo(() => {
            return Store.subscribe(handleNext3);
          }, []);
        }`,
  },
  {
    code: `function useInterval(callback, delay) {
          const savedCallback = useRef();
          useEffect(() => {
            savedCallback.current = callback;
          });
          useEffect(() => {
            function tick() {
              savedCallback.current();
            }
            if (delay !== null) {
              let id = setInterval(tick, delay);
              return () => clearInterval(id);
            }
          }, [delay]);
        }`,
  },
  {
    code: `function Counter() {
          const [count, setCount] = useState(0);

          useEffect(() => {
            let id = setInterval(() => {
              setCount(c => c + 1);
            }, 1000);
            return () => clearInterval(id);
          }, []);

          return <h1>{count}</h1>;
        }`,
  },
  {
    code: `function Counter(unstableProp) {
          let [count, setCount] = useState(0);
          setCount = unstableProp
          useEffect(() => {
            let id = setInterval(() => {
              setCount(c => c + 1);
            }, 1000);
            return () => clearInterval(id);
          }, [setCount]);

          return <h1>{count}</h1>;
        }`,
  },
  {
    code: `function Counter() {
          const [count, setCount] = useState(0);

          function tick() {
            setCount(c => c + 1);
          }

          useEffect(() => {
            let id = setInterval(() => {
              tick();
            }, 1000);
            return () => clearInterval(id);
          }, []);

          return <h1>{count}</h1>;
        }`,
  },
  {
    code: `function Counter() {
          const [count, dispatch] = useReducer((state, action) => {
            if (action === 'inc') {
              return state + 1;
            }
          }, 0);

          useEffect(() => {
            let id = setInterval(() => {
              dispatch('inc');
            }, 1000);
            return () => clearInterval(id);
          }, []);

          return <h1>{count}</h1>;
        }`,
  },
  {
    code: `function Counter() {
          const [count, dispatch] = useReducer((state, action) => {
            if (action === 'inc') {
              return state + 1;
            }
          }, 0);

          const tick = () => {
            dispatch('inc');
          };

          useEffect(() => {
            let id = setInterval(tick, 1000);
            return () => clearInterval(id);
          }, []);

          return <h1>{count}</h1>;
        }`,
  },
  {
    code: `function Podcasts() {
          useEffect(() => {
            setPodcasts([]);
          }, []);
          let [podcasts, setPodcasts] = useState(null);
        }`,
  },
  {
    code: `function withFetch(fetchPodcasts) {
          return function Podcasts({ id }) {
            let [podcasts, setPodcasts] = useState(null);
            useEffect(() => {
              fetchPodcasts(id).then(setPodcasts);
            }, [id]);
          }
        }`,
  },
  {
    code: `function Podcasts({ id }) {
          let [podcasts, setPodcasts] = useState(null);
          useEffect(() => {
            function doFetch({ fetchPodcasts }) {
              fetchPodcasts(id).then(setPodcasts);
            }
            doFetch({ fetchPodcasts: API.fetchPodcasts });
          }, [id]);
        }`,
  },
  {
    code: `function Counter() {
          let [count, setCount] = useState(0);

          function increment(x) {
            return x + 1;
          }

          useEffect(() => {
            let id = setInterval(() => {
              setCount(increment);
            }, 1000);
            return () => clearInterval(id);
          }, []);

          return <h1>{count}</h1>;
        }`,
  },
  {
    code: `function Counter() {
          let [count, setCount] = useState(0);

          function increment(x) {
            return x + 1;
          }

          useEffect(() => {
            let id = setInterval(() => {
              setCount(count => increment(count));
            }, 1000);
            return () => clearInterval(id);
          }, []);

          return <h1>{count}</h1>;
        }`,
  },
  {
    code: `import increment from './increment';
        function Counter() {
          let [count, setCount] = useState(0);

          useEffect(() => {
            let id = setInterval(() => {
              setCount(count => count + increment);
            }, 1000);
            return () => clearInterval(id);
          }, []);

          return <h1>{count}</h1>;
        }`,
  },
  {
    code: `function withStuff(increment) {
          return function Counter() {
            let [count, setCount] = useState(0);

            useEffect(() => {
              let id = setInterval(() => {
                setCount(count => count + increment);
              }, 1000);
              return () => clearInterval(id);
            }, []);

            return <h1>{count}</h1>;
          }
        }`,
  },
  {
    code: `function App() {
          const [query, setQuery] = useState('react');
          const [state, setState] = useState(null);
          useEffect(() => {
            let ignore = false;
            fetchSomething();
            async function fetchSomething() {
              const result = await (await fetch('http://hn.algolia.com/api/v1/search?query=' + query)).json();
              if (!ignore) setState(result);
            }
            return () => { ignore = true; };
          }, [query]);
          return (
            <>
              <input value={query} onChange={e => setQuery(e.target.value)} />
              {JSON.stringify(state)}
            </>
          );
        }`,
  },
  {
    code: `function Example() {
          useEffect(() => {
            arguments
          }, [])
        }`,
  },
  {
    code: `function Example() {
          useEffect(() => {
            const bar = () => {
              arguments;
            };
            bar();
          }, [])
        }`,
  },
  {
    code: `function Example(props) {
          useEffect(() => {
            let topHeight = 0;
            topHeight = props?.upperViewHeight;
          }, [props?.upperViewHeight]);
        }`,
  },
  {
    code: `function Example(props) {
          useEffect(() => {
            let topHeight = 0;
            topHeight = props?.upperViewHeight;
          }, [props]);
        }`,
  },
  {
    code: `function useFoo(foo){
          return useMemo(() => foo, [foo]);
        }`,
  },
  {
    code: `function useFoo(){
          const foo = 'hi!';
          return useMemo(() => foo, [foo]);
        }`,
  },
  {
    code: `function useFoo(){
          let {foo} = {foo: 1};
          return useMemo(() => foo, [foo]);
        }`,
  },
  {
    code: `function useFoo(){
          let [foo] = [1];
          return useMemo(() => foo, [foo]);
        }`,
  },
  {
    code: `function useFoo() {
          const foo = 'fine';
          if (true) {
            // Shadowed variable with constant construction in a nested scope is fine.
            const foo = {};
          }
          return useMemo(() => foo, [foo]);
        }`,
  },
  {
    code: `function MyComponent({foo}) {
          return useMemo(() => foo, [foo])
        }`,
  },
  {
    code: `function MyComponent() {
          const foo = true ? 'fine' : 'also fine';
          return useMemo(() => foo, [foo]);
        }`,
  },
  {
    code: `function MyComponent() {
          useEffect(() => {
            console.log('banana banana banana');
          }, undefined);
        }`,
  },
  {
    code: `function MyComponent() {
    const options = useOptions();
    useEffect(() => {
        if (!dropTargetRef.current) {
            return;
        }
        return dropTargetForElements({
            onDropTargetChange: (args) => {
                if (options && dropTargetRef.current) {
                  delete dropTargetRef.current.dataset['draggedOver'];
                }
            }
        });
    }, [options]);
}`,
  },
  {
    code: `export function useCanvasZoomOrScroll() {
           useEffect(() => {
               let wheelStopTimeoutId: { current: number | undefined } = { current: undefined };

               wheelStopTimeoutId = requestAnimationFrameTimeout(() => {
                   setLastInteraction?.(null);
               }, 300);

               return () => {
                   if (wheelStopTimeoutId.current !== undefined) {
                       console.log('h1');
                   }
               };
           }, []);
        }`,
  },
  {
    code: `function X() {
  const defaultParam1 = "";
  const myFunction = useCallback(
    (param1 = defaultParam1, param2) => {
    },
    [defaultParam1]
  );

  return null;
}
`,
  },
  {
    code: `function MyComponent() { const recursive = useCallback((n: number): number => (n <= 0 ? 0 : n + recursive(n - 1)), []); return recursive }`,
  },
  {
    code: `function Foo2() { useEffect(() => { foo() }, []); const foo = () => { bar() }; function bar () { foo() } }`,
  },
  {
    code: `function MyComponent(props) { useEffect(() => { console.log(props.foo!.bar) }, [props.foo!.bar]) }`,
  },
  {
    code: `function MyComponent(props) { useEffect(() => { console.log((props.foo).bar) }, [props.foo!.bar]) }`,
  },
  {
    code: `function MyComponent(props) { const external = {}; const y = useMemo(() => { const z = foo<typeof external>(); return z; }, []) }`,
  },
  {
    code: `function Test() { const [state, setState] = useState(); useEffect(() => { console.log("state", state); }); }`,
  },
  {
    code: `function MyComponent({ theme }) {
          const onStuff = useEffectEvent(() => {
            showNotification(theme);
          });
          useEffect(() => {
            onStuff();
          }, []);
          React.useEffect(() => {
            onStuff();
          }, []);
        }`,
  },
  {
    code: `function MyComponent({ data }) {
          useCallback(() => {
            console.log((data.count + 1).toString());
          }, [data.count]);
        }`,
  },
  {
    code: `
          const getFields = () => { return []; };
          function MyComponent() {
            const fields = useMemo(getFields, []);
            return fields;
          }
        `,
  },
  {
    code: `
          function checkIfIsSafari() { return false; }
          function MyComponent() {
            const isSafari = useMemo(checkIfIsSafari, []);
            return isSafari;
          }
        `,
  },
  {
    code: `
          function setup() { console.log('setup'); }
          function MyComponent() {
            useEffect(setup, []);
          }
        `,
  },
  {
    code: `function MyComponent4({ myRef }) { useCallback(() => { console.log(myRef.current); }, [myRef]); }`,
  },
  {
    code: `import { useEffect, useState } from "react";

export const useTest = () => {
    const [state] = useState<Record<"a", string>>({
        a: "a",
    });

    useEffect(() => {
        const a = "a" as keyof typeof state;
        console.log(a);
    }, []);

    console.log(state);
}`,
  },
  {
    code: `const Component = () => {
  const DATA = 'test' as const;
  const data = useMemo(() => DATA, []);
  return <div>{data}</div>;
};`,
  },
  {
    code: `const ReactActual = jest.requireActual('react');
const Component = ({ filter }) => {
    const [data, setData] = ReactActual.useState(filter);
    ReactActual.useEffect(() => {
        setData(filter);
    }, [filter]);

    return <div>test</div>;
};`,
  },
  {
    code: `const Component = () => {
          const setRef = React.useRef<(value: string) => void | null>(
            null,
          ) as React.MutableRefObject<(value: string) => void | null>;

          React.useEffect(() => {
            if (setRef.current) {
              console.log(setRef.current);
            }
          }, []);

          return <div>test</div>;
        };`,
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  {
    code: `function MyComponent(props) {
          useCallback(() => {
            console.log(props.foo?.toString());
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useCallback(() => {
            console.log(props.foo?.bar.baz);
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useCallback(() => {
            console.log(props.foo?.bar?.baz);
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useCallback(() => {
            console.log(props.foo?.bar.toString());
          }, []);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = someFunc();
          useEffect(() => {
            console.log(local);
          }, []);
        }`,
  },
  {
    code: `function Counter(unstableProp) {
          let [count, setCount] = useState(0);
          setCount = unstableProp
          useEffect(() => {
            let id = setInterval(() => {
              setCount(c => c + 1);
            }, 1000);
            return () => clearInterval(id);
          }, []);

          return <h1>{count}</h1>;
        }`,
  },
  {
    code: `function MyComponent() {
          let local = 42;
          useEffect(() => {
            console.log(local);
          }, []);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = /foo/;
          useEffect(() => {
            console.log(local);
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          const value = useMemo(() => { return 2*2; });
          const fn = useCallback(() => { alert('foo'); });
        }`,
  },
  {
    code: `function MyComponent({ fn1, fn2 }) {
          const value = useMemo(fn1);
          const fn = useCallback(fn2);
        }`,
  },
  {
    code: `function MyComponent() {
          useEffect()
          useLayoutEffect()
          useCallback()
          useMemo()
        }`,
  },
  {
    code: `function MyComponent() {
          const local = someFunc();
          useEffect(() => {
            if (true) {
              console.log(local);
            }
          }, []);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = {};
          useEffect(() => {
            try {
              console.log(local);
            } finally {}
          }, []);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = {};
          useEffect(() => {
            function inner() {
              console.log(local);
            }
            inner();
          }, []);
        }`,
  },
  {
    code: `function MyComponent() {
          const local1 = someFunc();
          {
            const local2 = someFunc();
            useEffect(() => {
              console.log(local1);
              console.log(local2);
            }, []);
          }
        }`,
  },
  {
    code: `function MyComponent() {
          const local1 = {};
          const local2 = {};
          useEffect(() => {
            console.log(local1);
            console.log(local2);
          }, [local1]);
        }`,
  },
  {
    code: `function MyComponent() {
          const local1 = {};
          const local2 = {};
          useMemo(() => {
            console.log(local1);
          }, [local1, local2]);
        }`,
  },
  {
    code: `function MyComponent() {
          const local1 = someFunc();
          function MyNestedComponent() {
            const local2 = {};
            useCallback(() => {
              console.log(local1);
              console.log(local2);
            }, [local1]);
          }
        }`,
  },
  {
    code: `function MyComponent() {
          const local = {};
          useEffect(() => {
            console.log(local);
            console.log(local);
          }, []);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = {};
          useEffect(() => {
            console.log(local);
            console.log(local);
          }, [local, local]);
        }`,
  },
  {
    code: `function MyComponent() {
          useCallback(() => {}, [window]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          let local = props.foo;
          useCallback(() => {}, [local]);
        }`,
  },
  {
    code: `function MyComponent({ history }) {
          useEffect(() => {
            return history.listen();
          }, []);
        }`,
  },
  {
    code: `function MyComponent({ history }) {
          useEffect(() => {
            return [
              history.foo.bar[2].dobedo.listen(),
              history.foo.bar().dobedo.listen[2]
            ];
          }, []);
        }`,
  },
  {
    code: `function MyComponent({ history }) {
          useEffect(() => {
            return [
              history?.foo
            ];
          }, []);
        }`,
  },
  {
    code: `function MyComponent() {
          useEffect(() => {}, ['foo']);
        }`,
  },
  {
    code: `function MyComponent({ foo, bar, baz }) {
          useEffect(() => {
            console.log(foo, bar, baz);
          }, ['foo', 'bar']);
        }`,
  },
  {
    code: `function MyComponent({ foo, bar, baz }) {
          useEffect(() => {
            console.log(foo, bar, baz);
          }, [42, false, null]);
        }`,
  },
  {
    code: `function MyComponent() {
          const dependencies = [];
          useEffect(() => {}, dependencies);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = {};
          const dependencies = [local];
          useEffect(() => {
            console.log(local);
          }, dependencies);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = {};
          const dependencies = [local];
          useEffect(() => {
            console.log(local);
          }, [...dependencies]);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = someFunc();
          useEffect(() => {
            console.log(local);
          }, [local, ...dependencies]);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = {};
          useEffect(() => {
            console.log(local);
          }, [computeCacheKey(local)]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            console.log(props.items[0]);
          }, [props.items[0]]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            console.log(props.items[0]);
          }, [props.items, props.items[0]]);
        }`,
  },
  {
    code: `function MyComponent({ items }) {
          useEffect(() => {
            console.log(items[0]);
          }, [items[0]]);
        }`,
  },
  {
    code: `function MyComponent({ items }) {
          useEffect(() => {
            console.log(items[0]);
          }, [items, items[0]]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          const local = {};
          useCallback(() => {
            console.log(props.foo);
            console.log(props.bar);
          }, [props, props.foo]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          const local = {};
          useCallback(() => {
            console.log(props.foo);
            console.log(props.bar);
          }, [props.foo, props]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          const local = {};
          useCallback(() => {
            console.log(props.foo);
            console.log(props.bar);
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          const foo = props.foo;
          useEffect(() => {
            const { bar } = foo();
            console.log(bar);
          }, [props.foo.bar]);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = {id: 42};
          useEffect(() => {
            console.log(local);
          }, [local.id]);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = {id: 42};
          const fn = useCallback(() => {
            console.log(local);
          }, [local.id]);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = {id: 42};
          const fn = useCallback(() => {
            console.log(local);
          }, [local.id, local]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          const fn = useCallback(() => {
            console.log(props.foo.bar.baz);
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          let color = {}
          const fn = useCallback(() => {
            console.log(props.foo.bar.baz);
            console.log(color);
          }, [props.foo, props.foo.bar.baz]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          const fn = useCallback(() => {
            console.log(props.foo.bar.baz);
          }, [props.foo.bar.baz, props.foo]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          const fn = useCallback(() => {
            console.log(props.foo.bar.baz);
            console.log(props.foo.fizz.bizz);
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          const fn = useCallback(() => {
            console.log(props.foo.bar);
          }, [props.foo.bar.baz]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          const fn = useCallback(() => {
            console.log(props);
            console.log(props.hello);
          }, [props.foo.bar.baz]);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = {};
          useEffect(() => {
            console.log(local);
          }, [local, local]);
        }`,
  },
  {
    code: `function MyComponent() {
          const local1 = {};
          useCallback(() => {
            const local1 = {};
            console.log(local1);
          }, [local1]);
        }`,
  },
  {
    code: `function MyComponent() {
          const local1 = {};
          useCallback(() => {}, [local1]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            console.log(props.foo);
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            console.log(props.foo);
            console.log(props.bar);
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          let a, b, c, d, e, f, g;
          useEffect(() => {
            console.log(b, e, d, c, a, g, f);
          }, [c, a, g]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          let a, b, c, d, e, f, g;
          useEffect(() => {
            console.log(b, e, d, c, a, g, f);
          }, [a, c, g]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          let a, b, c, d, e, f, g;
          useEffect(() => {
            console.log(b, e, d, c, a, g, f);
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          const local = {};
          useEffect(() => {
            console.log(props.foo);
            console.log(props.bar);
            console.log(local);
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          const local = {};
          useEffect(() => {
            console.log(props.foo);
            console.log(props.bar);
            console.log(local);
          }, [props]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            console.log(props.foo);
          }, []);
          useCallback(() => {
            console.log(props.foo);
          }, []);
          useMemo(() => {
            console.log(props.foo);
          }, []);
          React.useEffect(() => {
            console.log(props.foo);
          }, []);
          React.useCallback(() => {
            console.log(props.foo);
          }, []);
          React.useMemo(() => {
            console.log(props.foo);
          }, []);
          React.notReactiveHook(() => {
            console.log(props.foo);
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useCustomEffect(() => {
            console.log(props.foo);
          }, []);
          useEffect(() => {
            console.log(props.foo);
          }, []);
          React.useEffect(() => {
            console.log(props.foo);
          }, []);
          React.useCustomEffect(() => {
            console.log(props.foo);
          }, []);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = {};
          useEffect(() => {
            console.log(local);
          }, [a ? local : b]);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = {};
          useEffect(() => {
            console.log(local);
          }, [a && local]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {}, [props?.attribute.method()]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {}, [props.method()]);
        }`,
  },
  {
    code: `function MyComponent() {
          const ref = useRef();
          const [state, setState] = useState();
          useEffect(() => {
            ref.current = {};
            setState(state + 1);
          }, []);
        }`,
  },
  {
    code: `function MyComponent() {
          const ref = useRef();
          const [state, setState] = useState();
          useEffect(() => {
            ref.current = {};
            setState(state + 1);
          }, [ref]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          const ref1 = useRef();
          const ref2 = useRef();
          useEffect(() => {
            ref1.current.focus();
            console.log(ref2.current.textContent);
            alert(props.someOtherRefs.current.innerHTML);
            fetch(props.color);
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          const ref1 = useRef();
          const ref2 = useRef();
          useEffect(() => {
            ref1.current.focus();
            console.log(ref2.current.textContent);
            alert(props.someOtherRefs.current.innerHTML);
            fetch(props.color);
          }, [ref1.current, ref2.current, props.someOtherRefs, props.color]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          const ref1 = useRef();
          const ref2 = useRef();
          useEffect(() => {
            ref1?.current?.focus();
            console.log(ref2?.current?.textContent);
            alert(props.someOtherRefs.current.innerHTML);
            fetch(props.color);
          }, [ref1?.current, ref2?.current, props.someOtherRefs, props.color]);
        }`,
  },
  {
    code: `function MyComponent() {
          const ref = useRef();
          useEffect(() => {
            console.log(ref.current);
          }, [ref.current]);
        }`,
  },
  {
    code: `function MyComponent({ activeTab }) {
          const ref1 = useRef();
          const ref2 = useRef();
          useEffect(() => {
            ref1.current.scrollTop = 0;
            ref2.current.scrollTop = 0;
          }, [ref1.current, ref2.current, activeTab]);
        }`,
  },
  {
    code: `function MyComponent({ activeTab, initY }) {
          const ref1 = useRef();
          const ref2 = useRef();
          const fn = useCallback(() => {
            ref1.current.scrollTop = initY;
            ref2.current.scrollTop = initY;
          }, [ref1.current, ref2.current, activeTab, initY]);
        }`,
  },
  {
    code: `function MyComponent() {
          const ref = useRef();
          useEffect(() => {
            console.log(ref.current);
          }, [ref.current, ref]);
        }`,
  },
  {
    code: `const MyComponent = forwardRef((props, ref) => {
          useImperativeHandle(ref, () => ({
            focus() {
              alert(props.hello);
            }
          }), [])
        });`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            if (props.onChange) {
              props.onChange();
            }
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            if (props?.onChange) {
              props?.onChange();
            }
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            function play() {
              props.onPlay();
            }
            function pause() {
              props.onPause();
            }
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            if (props.foo.onChange) {
              props.foo.onChange();
            }
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            props.onChange();
            if (props.foo.onChange) {
              props.foo.onChange();
            }
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          const [skillsCount] = useState();
          useEffect(() => {
            if (skillsCount === 0 && !props.isEditMode) {
              props.toggleEditMode();
            }
          }, [skillsCount, props.isEditMode, props.toggleEditMode]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          const [skillsCount] = useState();
          useEffect(() => {
            if (skillsCount === 0 && !props.isEditMode) {
              props.toggleEditMode();
            }
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            externalCall(props);
            props.onChange();
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          useEffect(() => {
            props.onChange();
            externalCall(props);
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          let value;
          let value2;
          let value3;
          let value4;
          let asyncValue;
          useEffect(() => {
            if (value4) {
              value = {};
            }
            value2 = 100;
            value = 43;
            value4 = true;
            console.log(value2);
            console.log(value3);
            setTimeout(() => {
              asyncValue = 100;
            });
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          let value;
          let value2;
          let value3;
          let asyncValue;
          useEffect(() => {
            value = {};
            value2 = 100;
            value = 43;
            console.log(value2);
            console.log(value3);
            setTimeout(() => {
              asyncValue = 100;
            });
          }, [value, value2, value3]);
        }`,
  },
  {
    code: `function MyComponent() {
          const myRef = useRef();
          useEffect(() => {
            const handleMove = () => {};
            myRef.current.addEventListener('mousemove', handleMove);
            return () => myRef.current.removeEventListener('mousemove', handleMove);
          }, []);
          return <div ref={myRef} />;
        }`,
  },
  {
    code: `function MyComponent() {
          const myRef = useRef();
          useEffect(() => {
            const handleMove = () => {};
            myRef?.current?.addEventListener('mousemove', handleMove);
            return () => myRef?.current?.removeEventListener('mousemove', handleMove);
          }, []);
          return <div ref={myRef} />;
        }`,
  },
  {
    code: `function MyComponent() {
          const myRef = useRef();
          useEffect(() => {
            const handleMove = () => {};
            myRef.current.addEventListener('mousemove', handleMove);
            return () => myRef.current.removeEventListener('mousemove', handleMove);
          });
          return <div ref={myRef} />;
        }`,
  },
  {
    code: `function useMyThing(myRef) {
          useEffect(() => {
            const handleMove = () => {};
            myRef.current.addEventListener('mousemove', handleMove);
            return () => myRef.current.removeEventListener('mousemove', handleMove);
          }, [myRef]);
        }`,
  },
  {
    code: `function useMyThing(myRef) {
          useEffect(() => {
            const handleMouse = () => {};
            myRef.current.addEventListener('mousemove', handleMouse);
            myRef.current.addEventListener('mousein', handleMouse);
            return function() {
              setTimeout(() => {
                myRef.current.removeEventListener('mousemove', handleMouse);
                myRef.current.removeEventListener('mousein', handleMouse);
              });
            }
          }, [myRef]);
        }`,
  },
  {
    code: `function useMyThing(myRef, active) {
          useEffect(() => {
            const handleMove = () => {};
            if (active) {
              myRef.current.addEventListener('mousemove', handleMove);
              return function() {
                setTimeout(() => {
                  myRef.current.removeEventListener('mousemove', handleMove);
                });
              }
            }
          }, [myRef, active]);
        }`,
  },
  {
    code: `function MyComponent() {
          useEffect(() => {
            window.scrollTo(0, 0);
          }, [window]);
        }`,
  },
  {
    code: `import MutableStore from 'store';
        function MyComponent() {
          useEffect(() => {
            console.log(MutableStore.hello);
          }, [MutableStore.hello]);
        }`,
  },
  {
    code: `import MutableStore from 'store';
        let z = {};

        function MyComponent(props) {
          let x = props.foo;
          {
            let y = props.bar;
            useEffect(() => {
              console.log(MutableStore.hello.world, props.foo, x, y, z, global.stuff);
            }, [MutableStore.hello.world, props.foo, x, y, z, global.stuff]);
          }
        }`,
  },
  {
    code: `import MutableStore from 'store';
        let z = {};

        function MyComponent(props) {
          let x = props.foo;
          {
            let y = props.bar;
            useEffect(() => {
              // nothing
            }, [MutableStore.hello.world, props.foo, x, y, z, global.stuff]);
          }
        }`,
  },
  {
    code: `import MutableStore from 'store';
        let z = {};

        function MyComponent(props) {
          let x = props.foo;
          {
            let y = props.bar;
            const fn = useCallback(() => {
              // nothing
            }, [MutableStore.hello.world, props.foo, x, y, z, global.stuff]);
          }
        }`,
  },
  {
    code: `import MutableStore from 'store';
        let z = {};

        function MyComponent(props) {
          let x = props.foo;
          {
            let y = props.bar;
            const fn = useCallback(() => {
              // nothing
            }, [MutableStore?.hello?.world, props.foo, x, y, z, global?.stuff]);
          }
        }`,
  },
  {
    code: `function MyComponent(props) {
          let [, setState] = useState();
          let [, dispatch] = React.useReducer();
          let taint = props.foo;

          function handleNext1(value) {
            let value2 = value * taint;
            setState(value2);
            console.log('hello');
          }
          const handleNext2 = (value) => {
            setState(taint(value));
            console.log('hello');
          };
          let handleNext3 = function(value) {
            setTimeout(() => console.log(taint));
            dispatch({ type: 'x', value });
          };
          useEffect(() => {
            return Store.subscribe(handleNext1);
          }, []);
          useLayoutEffect(() => {
            return Store.subscribe(handleNext2);
          }, []);
          useMemo(() => {
            return Store.subscribe(handleNext3);
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          let [, setState] = useState();
          let [, dispatch] = React.useReducer();
          let taint = props.foo;

          // Shouldn't affect anything
          function handleChange() {}

          function handleNext1(value) {
            let value2 = value * taint;
            setState(value2);
            console.log('hello');
          }
          const handleNext2 = (value) => {
            setState(taint(value));
            console.log('hello');
          };
          let handleNext3 = function(value) {
            console.log(taint);
            dispatch({ type: 'x', value });
          };
          useEffect(() => {
            return Store.subscribe(handleNext1);
          }, []);
          useLayoutEffect(() => {
            return Store.subscribe(handleNext2);
          }, []);
          useMemo(() => {
            return Store.subscribe(handleNext3);
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          let [, setState] = useState();
          let [, dispatch] = React.useReducer();
          let taint = props.foo;

          // Shouldn't affect anything
          const handleChange = () => {};

          function handleNext1(value) {
            let value2 = value * taint;
            setState(value2);
            console.log('hello');
          }
          const handleNext2 = (value) => {
            setState(taint(value));
            console.log('hello');
          };
          let handleNext3 = function(value) {
            console.log(taint);
            dispatch({ type: 'x', value });
          };
          useEffect(() => {
            return Store.subscribe(handleNext1);
          }, []);
          useLayoutEffect(() => {
            return Store.subscribe(handleNext2);
          }, []);
          useMemo(() => {
            return Store.subscribe(handleNext3);
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          let [, setState] = useState();

          function handleNext(value) {
            setState(value);
          }

          useEffect(() => {
            return Store.subscribe(handleNext);
          }, [handleNext]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          let [, setState] = useState();

          const handleNext = (value) => {
            setState(value);
          };

          useEffect(() => {
            return Store.subscribe(handleNext);
          }, [handleNext]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          let [, setState] = useState();

          const handleNext = (value) => {
            setState(value);
          };

          useEffect(() => {
            return Store.subscribe(handleNext);
          }, [handleNext]);

          return <div onClick={handleNext} />;
        }`,
  },
  {
    code: `function MyComponent(props) {
          function handleNext1() {
            console.log('hello');
          }
          const handleNext2 = () => {
            console.log('hello');
          };
          let handleNext3 = function() {
            console.log('hello');
          };
          useEffect(() => {
            return Store.subscribe(handleNext1);
          }, [handleNext1]);
          useLayoutEffect(() => {
            return Store.subscribe(handleNext2);
          }, [handleNext2]);
          useMemo(() => {
            return Store.subscribe(handleNext3);
          }, [handleNext3]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          function handleNext1() {
            console.log('hello');
          }
          const handleNext2 = () => {
            console.log('hello');
          };
          let handleNext3 = function() {
            console.log('hello');
          };
          useEffect(() => {
            handleNext1();
            return Store.subscribe(() => handleNext1());
          }, [handleNext1]);
          useLayoutEffect(() => {
            handleNext2();
            return Store.subscribe(() => handleNext2());
          }, [handleNext2]);
          useMemo(() => {
            handleNext3();
            return Store.subscribe(() => handleNext3());
          }, [handleNext3]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          function handleNext1() {
            console.log('hello');
          }
          const handleNext2 = () => {
            console.log('hello');
          };
          let handleNext3 = function() {
            console.log('hello');
          };
          useEffect(() => {
            handleNext1();
            return Store.subscribe(() => handleNext1());
          }, [handleNext1]);
          useLayoutEffect(() => {
            handleNext2();
            return Store.subscribe(() => handleNext2());
          }, [handleNext2]);
          useMemo(() => {
            handleNext3();
            return Store.subscribe(() => handleNext3());
          }, [handleNext3]);
          return (
            <div
              onClick={() => {
                handleNext1();
                setTimeout(handleNext2);
                setTimeout(() => {
                  handleNext3();
                });
              }}
            />
          );
        }`,
  },
  {
    code: `function MyComponent(props) {
          const handleNext1 = () => {
            console.log('hello');
          };
          function handleNext2() {
            console.log('hello');
          }
          useEffect(() => {
            return Store.subscribe(handleNext1);
            return Store.subscribe(handleNext2);
          }, [handleNext1, handleNext2]);
          useEffect(() => {
            return Store.subscribe(handleNext1);
            return Store.subscribe(handleNext2);
          }, [handleNext1, handleNext2]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          let handleNext = () => {
            console.log('hello');
          };
          if (props.foo) {
            handleNext = () => {
              console.log('hello');
            };
          }
          useEffect(() => {
            return Store.subscribe(handleNext);
          }, [handleNext]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          let [, setState] = useState();
          let taint = props.foo;

          function handleNext(value) {
            let value2 = value * taint;
            setState(value2);
            console.log('hello');
          }

          useEffect(() => {
            return Store.subscribe(handleNext);
          }, [handleNext]);
        }`,
  },
  {
    code: `function Counter() {
          let [count, setCount] = useState(0);

          useEffect(() => {
            let id = setInterval(() => {
              setCount(count + 1);
            }, 1000);
            return () => clearInterval(id);
          }, []);

          return <h1>{count}</h1>;
        }`,
  },
  {
    code: `function Counter() {
          let [count, setCount] = useState(0);
          let [increment, setIncrement] = useState(0);

          useEffect(() => {
            let id = setInterval(() => {
              setCount(count + increment);
            }, 1000);
            return () => clearInterval(id);
          }, []);

          return <h1>{count}</h1>;
        }`,
  },
  {
    code: `function Counter() {
          let [count, setCount] = useState(0);
          let [increment, setIncrement] = useState(0);

          useEffect(() => {
            let id = setInterval(() => {
              setCount(count => count + increment);
            }, 1000);
            return () => clearInterval(id);
          }, []);

           return <h1>{count}</h1>;
         }`,
  },
  {
    code: `function Counter() {
          let [count, setCount] = useState(0);
          let increment = useCustomHook();

          useEffect(() => {
            let id = setInterval(() => {
              setCount(count => count + increment);
            }, 1000);
            return () => clearInterval(id);
          }, []);

          return <h1>{count}</h1>;
        }`,
  },
  {
    code: `function Counter({ step }) {
          let [count, setCount] = useState(0);

          function increment(x) {
            return x + step;
          }

          useEffect(() => {
            let id = setInterval(() => {
              setCount(count => increment(count));
            }, 1000);
            return () => clearInterval(id);
          }, []);

          return <h1>{count}</h1>;
        }`,
  },
  {
    code: `function Counter({ step }) {
          let [count, setCount] = useState(0);

          function increment(x) {
            return x + step;
          }

          useEffect(() => {
            let id = setInterval(() => {
              setCount(count => increment(count));
            }, 1000);
            return () => clearInterval(id);
          }, [increment]);

          return <h1>{count}</h1>;
        }`,
  },
  {
    code: `function Counter({ increment }) {
          let [count, setCount] = useState(0);

          useEffect(() => {
            let id = setInterval(() => {
              setCount(count => count + increment);
            }, 1000);
            return () => clearInterval(id);
          }, []);

          return <h1>{count}</h1>;
        }`,
  },
  {
    code: `function Counter() {
          const [count, setCount] = useState(0);

          function tick() {
            setCount(count + 1);
          }

          useEffect(() => {
            let id = setInterval(() => {
              tick();
            }, 1000);
            return () => clearInterval(id);
          }, []);

          return <h1>{count}</h1>;
        }`,
  },
  {
    code: `function Podcasts() {
          useEffect(() => {
            alert(podcasts);
          }, []);
          let [podcasts, setPodcasts] = useState(null);
        }`,
  },
  {
    code: `function Podcasts({ fetchPodcasts, id }) {
          let [podcasts, setPodcasts] = useState(null);
          useEffect(() => {
            fetchPodcasts(id).then(setPodcasts);
          }, [id]);
        }`,
  },
  {
    code: `function Podcasts({ api: { fetchPodcasts }, id }) {
          let [podcasts, setPodcasts] = useState(null);
          useEffect(() => {
            fetchPodcasts(id).then(setPodcasts);
          }, [id]);
        }`,
  },
  {
    code: `function Podcasts({ fetchPodcasts, fetchPodcasts2, id }) {
          let [podcasts, setPodcasts] = useState(null);
          useEffect(() => {
            setTimeout(() => {
              console.log(id);
              fetchPodcasts(id).then(setPodcasts);
              fetchPodcasts2(id).then(setPodcasts);
            });
          }, [id]);
        }`,
  },
  {
    code: `function Podcasts({ fetchPodcasts, id }) {
          let [podcasts, setPodcasts] = useState(null);
          useEffect(() => {
            console.log(fetchPodcasts);
            fetchPodcasts(id).then(setPodcasts);
          }, [id]);
        }`,
  },
  {
    code: `function Podcasts({ fetchPodcasts, id }) {
          let [podcasts, setPodcasts] = useState(null);
          useEffect(() => {
            console.log(fetchPodcasts);
            fetchPodcasts?.(id).then(setPodcasts);
          }, [id]);
        }`,
  },
  {
    code: `function Hello() {
          const [data, setData] = useState(0);
          useEffect(() => {
            fetchData.then(setData);
          });
        }`,
  },
  {
    code: `function Hello({ country }) {
          const [data, setData] = useState(0);
          useEffect(() => {
            fetchData(country).then(setData);
          });
        }`,
  },
  {
    code: `function Hello({ prop1, prop2 }) {
          const [state, setState] = useState(0);
          useEffect(() => {
            if (prop1) {
              setState(prop2);
            }
          });
        }`,
  },
  {
    code: `function Thing() {
          useEffect(async () => {}, []);
        }`,
  },
  {
    code: `function Thing() {
          useEffect(async () => {});
        }`,
  },
  {
    code: `function MyComponent() {
          const local = {};
          function myEffect() {
            console.log(local);
          }
          useEffect(myEffect, []);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = {};
          const myEffect = () => {
            console.log(local);
          };
          useEffect(myEffect, []);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = {};
          const myEffect = function() {
            console.log(local);
          };
          useEffect(myEffect, []);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = {};
          const myEffect = () => {
            otherThing();
          };
          const otherThing = () => {
            console.log(local);
          };
          useEffect(myEffect, []);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = {};
          const myEffect = debounce(() => {
            console.log(local);
          }, delay);

          useEffect(myEffect, []);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = {};
          const myEffect = debounce(() => {
            console.log(local);
          }, delay);
          useEffect(myEffect, [local]);
        }`,
  },
  {
    code: `function MyComponent({myEffect}) {
          useEffect(myEffect, []);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = {};
          useEffect(debounce(() => {
            console.log(local);
          }, delay), []);
        }`,
  },
  {
    code: `function MyComponent() {
          const local = {};
          useEffect(() => {
            console.log(local);
          }, []);
        }`,
  },
  {
    code: `function MyComponent(props) {
          let foo = {}
          useEffect(() => {
            foo.bar.baz = 43;
            props.foo.bar.baz = 1;
          }, []);
        }`,
  },
  {
    code: `function Component() {
          const foo = {};
          useMemo(() => foo, [foo]);
        }`,
  },
  {
    code: `function Component() {
          const foo = [];
          useMemo(() => foo, [foo]);
        }`,
  },
  {
    code: `function Component() {
          const foo = () => {};
          useMemo(() => foo, [foo]);
        }`,
  },
  {
    code: `function Component() {
          const foo = function bar(){};
          useMemo(() => foo, [foo]);
        }`,
  },
  {
    code: `function Component() {
          const foo = class {};
          useMemo(() => foo, [foo]);
        }`,
  },
  {
    code: `function Component() {
          const foo = true ? {} : 'fine';
          useMemo(() => foo, [foo]);
        }`,
  },
  {
    code: `function Component() {
          const foo = bar || {};
          useMemo(() => foo, [foo]);
        }`,
  },
  {
    code: `function Component() {
          const foo = bar ?? {};
          useMemo(() => foo, [foo]);
        }`,
  },
  {
    code: `function Component() {
          const foo = bar && {};
          useMemo(() => foo, [foo]);
        }`,
  },
  {
    code: `function Component() {
          const foo = bar ? baz ? {} : null : null;
          useMemo(() => foo, [foo]);
        }`,
  },
  {
    code: `function Component() {
          let foo = {};
          useMemo(() => foo, [foo]);
        }`,
  },
  {
    code: `function Component() {
          var foo = {};
          useMemo(() => foo, [foo]);
        }`,
  },
  {
    code: `function Component() {
          const foo = {};
          useCallback(() => {
            console.log(foo);
          }, [foo]);
        }`,
  },
  {
    code: `function Component() {
          const foo = {};
          useEffect(() => {
            console.log(foo);
          }, [foo]);
        }`,
  },
  {
    code: `function Component() {
          const foo = {};
          useLayoutEffect(() => {
            console.log(foo);
          }, [foo]);
        }`,
  },
  {
    code: `function Component() {
          const foo = {};
          useImperativeHandle(
            ref,
            () => {
               console.log(foo);
            },
            [foo]
          );
        }`,
  },
  {
    code: `function Foo(section) {
          const foo = section.section_components?.edges ?? [];
          useEffect(() => {
            console.log(foo);
          }, [foo]);
        }`,
  },
  {
    code: `function Foo(section) {
          const foo = {};
          console.log(foo);
          useMemo(() => {
            console.log(foo);
          }, [foo]);
        }`,
  },
  {
    code: `function Foo() {
          const foo = <>Hi!</>;
          useMemo(() => {
            console.log(foo);
          }, [foo]);
        }`,
  },
  {
    code: `function Foo() {
          const foo = <div>Hi!</div>;
          useMemo(() => {
            console.log(foo);
          }, [foo]);
        }`,
  },
  {
    code: `function Foo() {
          const foo = bar = {};
          useMemo(() => {
            console.log(foo);
          }, [foo]);
        }`,
  },
  {
    code: `function Foo() {
          const foo = new String('foo'); // Note 'foo' will be boxed, and thus an object and thus compared by reference.
          useMemo(() => {
            console.log(foo);
          }, [foo]);
        }`,
  },
  {
    code: `function Foo() {
          const foo = new Map([]);
          useMemo(() => {
            console.log(foo);
          }, [foo]);
        }`,
  },
  {
    code: `function Foo() {
          const foo = /reg/;
          useMemo(() => {
            console.log(foo);
          }, [foo]);
        }`,
  },
  {
    code: `function Foo() {
          class Bar {};
          useMemo(() => {
            console.log(new Bar());
          }, [Bar]);
        }`,
  },
  {
    code: `function Foo() {
          const foo = {};
          useLayoutEffect(() => {
            console.log(foo);
          }, [foo]);
          useEffect(() => {
            console.log(foo);
          }, [foo]);
        }`,
  },
  {
    code: `function MyComponent({ theme }) {
          const onStuff = useEffectEvent(() => {
            showNotification(theme);
          });
          useEffect(() => {
            onStuff();
          }, [onStuff]);
          React.useEffect(() => {
            onStuff();
          }, [onStuff]);
        }`,
  },
  {
    code: `function MyComponent(props) {
          if (props.ok) {
            const callback = () => props.value;
            useMemo(callback, []);
          }
        }`,
  },
  {
    code: `function MyComponent({ myRef }) {
    useCallback(() => { console.log(myRef.current); }, [myRef.current]);
    // React Hook useCallback has a missing dependency: 'myRef'. Either include it or remove the dependency array. Mutable values like 'myRef.current' aren't valid dependencies because mutating them doesn't re-render the component.
}`,
  },
  {
    code: `function MyComponent2({ myRef }) {
    useCallback(() => { console.log(myRef.current); }, []);
    // React Hook useCallback has a missing dependency: 'myRef'. Either include it or remove the dependency array.
}`,
  },
];
