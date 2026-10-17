import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { classComponentMissingComponentWillUnmountTeardown } from "./class-component-missing-component-will-unmount-teardown.js";

interface PlatformSubscriptionTestCase {
  name: string;
  code: string;
  expected: number;
  expectedColumn?: number;
}

const cases: PlatformSubscriptionTestCase[] = [
  {
    name: "same-platform-helpers",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 0,
  },
  {
    name: "same-platform-async-without-await",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { async componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 0,
  },
  {
    name: "different-platform-cleanup",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "android" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "unguarded-acquisition-guarded-cleanup",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "additional-cleanup-prop-guard",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.props.close && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "selected-handle-overwrite",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } replaceHandle(){ this.subscription = replacement; } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "selected-helper-replacement",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nListenerPanel.prototype.acquire = replacement;',
    expected: 1,
  },
  {
    name: "foreign-platform-provider",
    code: 'import React from "react"; import { Keyboard } from "react-native"; import { Platform } from "foreign-platform";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "platform-property-write",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nPlatform.OS = "ios";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "keyboard-provider-write",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nKeyboard.addListener = replacement;\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "suspension-before-acquisition",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { async componentDidMount(){ await pending; Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "ordinary-native-dismiss-and-static-asset",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } dismiss(){ Keyboard.dismiss(); } render(){ return <img src={require("./icon.png")}/>; } }',
    expected: 0,
  },
  {
    name: "named-pure-component-with-jsx-default",
    code: 'import React, { PureComponent as PanelBase } from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends PanelBase { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 0,
  },
  {
    name: "async-lexical-setstate-completion",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } finish(){ this.setState({ready:true}, async () => { await pending; }); } render(){ return null; } }',
    expected: 0,
  },
  {
    name: "opaque-native-completion-transport",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } finish(){ this.forceUpdate(moduleLocalCompletion); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "early-unmount-return",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ return; Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "second-canonical-platform-alias-write",
    code: 'import React from "react"; import { Keyboard, Platform, Platform as OtherPlatform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nconst changePlatform = () => { OtherPlatform.OS = "android"; };',
    expected: 1,
  },
  {
    name: "literal-relative-static-image-policy",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nconst image = require("./icon.png");',
    expected: 0,
  },
  {
    name: "canonical-named-pure-component",
    code: 'import React, { PureComponent } from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends PureComponent { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 0,
  },
  {
    name: "canonical-named-component",
    code: 'import { Component } from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 0,
  },
  {
    name: "native-named-provider-aliases",
    code: 'import React from "react"; import { Keyboard as Keys, Platform as DevicePlatform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ DevicePlatform.OS === "ios" && this.acquire(); } componentWillUnmount(){ DevicePlatform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keys.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 0,
  },
  {
    name: "android-platform",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "android" && this.acquire(); } componentWillUnmount(){ Platform.OS === "android" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 0,
  },
  {
    name: "explicit-null-owned-field",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { subscription = null; componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 0,
  },
  {
    name: "ordinary-react-metadata",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nListenerPanel.propTypes = {}; ListenerPanel.defaultProps = {}; export default ListenerPanel;',
    expected: 0,
  },
  {
    name: "metadata-compound-write",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nListenerPanel.defaultProps += {};',
    expected: 1,
  },
  {
    name: "duplicate-metadata-write",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nListenerPanel.defaultProps = {}; ListenerPanel.defaultProps = {};',
    expected: 1,
  },
  {
    name: "metadata-class-escape",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nListenerPanel.defaultProps = { saved: ListenerPanel };',
    expected: 1,
  },
  {
    name: "class-prototype-write",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nListenerPanel.prototype.release = () => {};',
    expected: 1,
  },
  {
    name: "static-metadata-accessor",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { static get defaultProps(){return {}} componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "own-metadata-override",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { defaultProps = {}; componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "class-decorator",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\n@decorate class ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "foreign-component-provider",
    code: 'import React from "foreign"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "type-only-component-provider",
    code: 'import type React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "type-only-named-base",
    code: 'import type { PureComponent } from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends PureComponent { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "react-provider-write",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nReact.Component = Replacement;',
    expected: 1,
  },
  {
    name: "react-provider-escape",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nconsume(React);',
    expected: 1,
  },
  {
    name: "second-react-provider-write",
    code: 'import React, * as OtherReact from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nOtherReact.Component = Replacement;',
    expected: 1,
  },
  {
    name: "keyboard-namespace-carrier",
    code: 'import React from "react"; import * as Native from "react-native"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "native-deep-module-carrier",
    code: 'import React from "react"; import NativeKeyboard from "react-native/Libraries/Keyboard/Keyboard"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "type-only-keyboard-provider",
    code: 'import React from "react"; import { type Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "type-only-platform-provider",
    code: 'import React from "react"; import { Keyboard, type Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "keyboard-provider-escape",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nconsume(Keyboard);',
    expected: 1,
  },
  {
    name: "keyboard-method-extraction",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nconst listen = Keyboard.addListener;',
    expected: 1,
  },
  {
    name: "platform-provider-escape",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nconsume(Platform);',
    expected: 1,
  },
  {
    name: "platform-pattern-write",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\n[Platform.OS] = ["android"];',
    expected: 1,
  },
  {
    name: "keyboard-pattern-write",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\n({value:Keyboard.addListener} = replacement);',
    expected: 1,
  },
  {
    name: "cleanup-extra-prop-guard",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.props.ready && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "loose-platform-guard",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS == "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS == "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "platform-select-guard",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.select({ios:true}) && this.acquire(); } componentWillUnmount(){ Platform.select({ios:true}) && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "computed-platform-selector",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform["OS"] === "ios" && this.acquire(); } componentWillUnmount(){ Platform["OS"] === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "optional-platform-selector",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform?.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform?.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "early-mount-return",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ return; Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 0,
  },
  {
    name: "opaque-unmount-prelude",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ opaque(); Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "cleanup-helper-prelude",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ opaque(); this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "cleanup-helper-early-return",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ return; this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "duplicate-field-acquisition",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "selected-field-pattern-write",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } change(){ [this.subscription] = [replacement]; } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "selected-field-loop-write",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } change(){ for(this.subscription of replacements){} } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "selected-field-escape",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } change(){ consume(this.subscription); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "whole-instance-escape",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } change(){ consume(this); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "async-completion-field-write",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } change(){ this.setState({ready:true}, async () => { await pending; this.subscription = replacement; }); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "async-completion-instance-escape",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } change(){ this.setState({ready:true}, async () => { await pending; consume(this); }); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "normal-completion-function",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } change(){ this.setState({ready:true}, function(){}); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "setstate-updater-function",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } change(){ this.setState(() => ({ready:true})); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "setstate-spread-object",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } change(){ this.setState({...update}); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "setstate-computed-object",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } change(){ this.setState({[opaque()]:true}); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "forceupdate-without-callback",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } change(){ this.forceUpdate(); } render(){ return null; } }',
    expected: 0,
  },
  {
    name: "native-super-member",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } change(){ super.forceUpdate(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "native-updater-replacement",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } change(){ this.updater = replacement; } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "third-super-argument",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { constructor(props){super(props,null,replacement);} componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "ordinary-native-constructor",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { constructor(props){super(props);} componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 0,
  },
  {
    name: "constructor-value-return",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { constructor(props){super(props);return replacement;} componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "own-setstate-override",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } setState(update){} render(){ return null; } }',
    expected: 1,
  },
  {
    name: "selected-helper-export",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } change(){ consume(this.acquire); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "duplicate-selected-helper",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } acquire(){} render(){ return null; } }',
    expected: 0,
  },
  {
    name: "accessor-selected-field",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { get subscription(){return replacement;} componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "computed-selected-field",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this["subscription"] = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "optional-native-acquisition",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener?.("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "noninline-native-callback",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", handler); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "two-covered-owned-fields",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); Platform.OS === "ios" && this.acquireOther(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } acquireOther(){ this.other = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); this.other.remove(); } render(){ return null; } }',
    expected: 0,
  },
  {
    name: "one-covered-one-unhandled-hazard",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); setInterval(() => {}, 1000); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "relative-asset-jpeg",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nconst image = require("../images/icon.jpeg");',
    expected: 0,
  },
  {
    name: "shadowed-asset-require",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nconst require = loader; const image = require("./icon.png");',
    expected: 1,
  },
  {
    name: "optional-asset-require",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nconst image = require?.("./icon.png");',
    expected: 1,
  },
  {
    name: "dynamic-asset-require",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nconst image = require(asset);',
    expected: 1,
  },
  {
    name: "native-module-require",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nvoid require("react-native");',
    expected: 1,
  },
  {
    name: "module-loader-require",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nvoid require("node:module");',
    expected: 1,
  },
  {
    name: "dynamic-module-import",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nvoid import("react-native");',
    expected: 1,
  },
  {
    name: "benign-eval-exposure",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nvoid eval;',
    expected: 1,
  },
  {
    name: "benign-function-exposure",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nvoid Function;',
    expected: 1,
  },
  {
    name: "native-reflection-exposure",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nvoid Reflect;',
    expected: 1,
  },
  {
    name: "shadowed-reflection-name",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nconst Reflect = {}; void Reflect;',
    expected: 0,
  },
  {
    name: "constructor-extraction",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nconst {constructor: carrier} = ordinary;',
    expected: 1,
  },
  {
    name: "ordinary-property-extraction",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nconst {ready} = ordinary;',
    expected: 0,
  },
  {
    name: "closed-own-method-bind-receiver",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } change(){ this.setState({ready:true}); } render(){ return <button onClick={this.change.bind(this)}/>; } }',
    expected: 0,
  },
  {
    name: "closed-own-method-bind-replacement",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } change(){ this.setState({ready:true}); } replace(){ this.change.bind = foreign; } render(){ return <button onClick={this.change.bind(this)}/>; } }',
    expected: 1,
  },
  {
    name: "getter-bind-receiver",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } get change(){ return foreign; } render(){ return <button onClick={this.change.bind(this)}/>; } }',
    expected: 1,
  },
  {
    name: "bind-extra-argument",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } change(){ this.setState({ready:true}); } render(){ return <button onClick={this.change.bind(this, ready)}/>; } }',
    expected: 1,
  },
  {
    name: "selected-acquire-bind-receiver",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return <button onClick={this.acquire.bind(this)}/>; } }',
    expected: 1,
  },
  {
    name: "extracted-bind-receiver",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } change(){ this.setState({ready:true}); } render(){ const callback = this.change; return <button onClick={callback.bind(this)}/>; } }',
    expected: 1,
  },
  {
    name: "bound-own-method-deferred-field-write",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } change(){ schedule(() => { this.subscription = replacement; }); } render(){ return <button onClick={this.change.bind(this)}/>; } }',
    expected: 1,
  },
  {
    name: "foreign-bind-receiver",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return <button onClick={this.props.callback.bind(this)}/>; } }',
    expected: 1,
  },
  {
    name: "only-unreleased-second-hazard-reported",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); Platform.OS === "ios" && this.acquireOther(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } acquireOther(){ this.other = Keyboard.addListener("other", () => {}); } render(){ return null; } }',
    expected: 1,
    expectedColumn: 368,
  },
  {
    name: "named-native-default-carrier-unused",
    code: 'import { default as NativeRuntime } from "react-native";\nimport React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "named-native-default-carrier-read",
    code: 'import { default as NativeRuntime } from "react-native";\nimport React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nvoid NativeRuntime;',
    expected: 1,
  },
  {
    name: "runtime-namespace-provider-read",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nnamespace NativeInspection { void Platform; }',
    expected: 1,
  },
  {
    name: "runtime-enum-provider-read",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nenum NativeInspection { Selected = (Platform.OS = "android", 1) }',
    expected: 1,
  },
  {
    name: "runtime-export-assignment-provider-read",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nexport = Keyboard.addListener;',
    expected: 1,
  },
  {
    name: "runtime-parameter-property-provider-read",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { constructor(public native = Platform){super();} componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "unused-type-only-react-carrier",
    code: 'import type * as ReactTypes from "react";\nimport React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 0,
  },
  {
    name: "unused-type-only-native-carrier",
    code: 'import type * as NativeTypes from "react-native";\nimport React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 0,
  },
  {
    name: "type-only-native-carrier-used-as-type",
    code: 'import type * as NativeTypes from "react-native";\nimport React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\ntype NativeShape = typeof NativeTypes;',
    expected: 0,
  },
  {
    name: "type-only-react-carrier-runtime-read",
    code: 'import type * as ReactTypes from "react";\nimport React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nvoid ReactTypes;',
    expected: 1,
  },
  {
    name: "type-only-native-carrier-runtime-read",
    code: 'import type * as NativeTypes from "react-native";\nimport React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nvoid NativeTypes;',
    expected: 1,
  },
  {
    name: "inline-type-only-react-carrier-runtime-read",
    code: 'import { type Component as TypedBase } from "react";\nimport React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nvoid TypedBase;',
    expected: 1,
  },
  {
    name: "inline-type-only-native-carrier-runtime-read",
    code: 'import { type Keyboard as TypedKeyboard } from "react-native";\nimport React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nvoid TypedKeyboard;',
    expected: 1,
  },
  {
    name: "extra-native-subclass-super-projection",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nclass NativeCarrier extends React.Component { static inspect(){ void super.prototype; } }',
    expected: 1,
  },
  {
    name: "unused-type-only-native-subpath",
    code: 'import type * as NativeTypes from "react-native/Libraries/Keyboard/Keyboard";\nimport React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 0,
  },
  {
    name: "type-only-native-subpath-runtime-read",
    code: 'import type * as NativeTypes from "react-native/Libraries/Keyboard/Keyboard";\nimport React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nvoid NativeTypes;',
    expected: 1,
  },
  {
    name: "duplicate-empty-helper-before-registration",
    code: 'import React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){} acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }',
    expected: 1,
  },
  {
    name: "native-emitter-prototype-read",
    code: 'import { NativeEventEmitter } from "react-native";\nimport React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nvoid NativeEventEmitter.prototype;',
    expected: 1,
  },
  {
    name: "native-emitter-name-scalar-read",
    code: 'import { NativeEventEmitter } from "react-native";\nimport React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nvoid NativeEventEmitter.name;',
    expected: 0,
  },
  {
    name: "native-emitter-whole-value-alias",
    code: 'import { NativeEventEmitter } from "react-native";\nimport React from "react"; import { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component { componentDidMount(){ Platform.OS === "ios" && this.acquire(); } componentWillUnmount(){ Platform.OS === "ios" && this.release(); } acquire(){ this.subscription = Keyboard.addListener("change", () => {}); } release(){ this.subscription.remove(); } render(){ return null; } }\nconst Carrier = NativeEventEmitter; void Carrier;',
    expected: 1,
  },
];

describe("platform-owned native subscription cleanup", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(classComponentMissingComponentWillUnmountTeardown, testCase.code, {
        filename: "independent-platform-subscription.tsx",
        forceJsx: true,
        includeLocations: true,
        settings: { "react-doctor": { capabilities: ["react"], portedRuleMode: "curated" } },
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expected);
      if (testCase.expectedColumn !== undefined)
        expect(result.diagnostics[0]?.column).toBe(testCase.expectedColumn);
    });
  }
});
