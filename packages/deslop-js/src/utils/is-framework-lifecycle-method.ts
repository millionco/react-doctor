/**
 * Methods invoked by-name by React / Angular runtimes. Static "no caller"
 * analysis can't see those call sites, so without this allowlist
 * `unusedClassMembers` would fire on every component.
 */
const FRAMEWORK_LIFECYCLE_METHODS = new Set<string>([
  "render",
  "componentDidMount",
  "componentDidUpdate",
  "componentWillUnmount",
  "shouldComponentUpdate",
  "getSnapshotBeforeUpdate",
  "getDerivedStateFromProps",
  "getDerivedStateFromError",
  "componentDidCatch",
  "componentWillMount",
  "componentWillReceiveProps",
  "componentWillUpdate",
  "UNSAFE_componentWillMount",
  "UNSAFE_componentWillReceiveProps",
  "UNSAFE_componentWillUpdate",
  "getChildContext",
  "contextType",
  "ngOnInit",
  "ngOnDestroy",
  "ngOnChanges",
  "ngDoCheck",
  "ngAfterContentInit",
  "ngAfterContentChecked",
  "ngAfterViewInit",
  "ngAfterViewChecked",
  "ngAcceptInputType",
  "canActivate",
  "canDeactivate",
  "canActivateChild",
  "canMatch",
  "resolve",
  "intercept",
  "transform",
  "validate",
  "registerOnChange",
  "registerOnTouched",
  "writeValue",
  "setDisabledState",
]);

export const isFrameworkLifecycleMethod = (name: string): boolean =>
  FRAMEWORK_LIFECYCLE_METHODS.has(name);
