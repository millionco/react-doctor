import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoRawText } from "./rn-no-raw-text.js";

const expectFail = (code: string, settings?: Readonly<Record<string, unknown>>): void => {
  const result = runRule(rnNoRawText, code, { settings, filename: "App.native.tsx" });
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string, settings?: Readonly<Record<string, unknown>>): void => {
  const result = runRule(rnNoRawText, code, { settings, filename: "App.native.tsx" });
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("react-native/rn-no-raw-text", () => {
  it("fires on raw text with no Text ancestor", () => {
    expectFail(`const App = () => <View>Hello</View>;`);
  });

  it("does not fire inside a real Text component", () => {
    expectPass(`const App = () => <Text>Hello</Text>;`);
  });

  describe("auto-detected text wrappers", () => {
    it("suppresses string-only usage of an arrow forwarder", () => {
      expectPass(`
        const Banner = ({ children }) => <Text>{children}</Text>;
        const App = () => <Banner>Hello</Banner>;
      `);
    });

    it("suppresses a spread re-export wrapper", () => {
      expectPass(`
        export const Caption = (props) => <Text {...props} />;
        const App = () => <Caption>hi there</Caption>;
      `);
    });

    it("suppresses a function-declaration forwarder", () => {
      expectPass(`
        function Banner({ children }) { return <Text>{children}</Text>; }
        const App = () => <Banner>Hello</Banner>;
      `);
    });

    it("works regardless of declaration order (usage before definition)", () => {
      expectPass(`
        const App = () => <Banner>Hello</Banner>;
        const Banner = ({ children }) => <Text>{children}</Text>;
      `);
    });

    // The forwarder's `<Text>` root wraps WHATEVER children it receives, so
    // mixed children (`<Label><Icon/> text</Label>`) render that text inside
    // `<Text>` — no crash. Reporting it would be a false positive, so an
    // auto-detected forwarder is trusted like a real text container.
    it("does not fire on mixed children of an auto-detected forwarder", () => {
      expectPass(`
        const Label = ({ children }) => <Text>{children}</Text>;
        const App = () => <Label><Icon /> text</Label>;
      `);
    });

    it("does not treat a non-text forwarder as a wrapper", () => {
      expectFail(`
        const Box = ({ children }) => <View>{children}</View>;
        const App = () => <Box>Hello</Box>;
      `);
    });

    // An imported (cross-file) text-named component has no in-file definition,
    // so it's suppressed by the name heuristic instead — same safe result.
    it("suppresses an imported text-named component via the name heuristic", () => {
      expectPass(`
        import { Label } from "./ui";
        const App = () => <Label><Icon /> text</Label>;
      `);
    });

    it("suppresses a wrapper forwarding children into a nested Text", () => {
      expectPass(`
        function Chip({ children }) {
          return (
            <View testID="Chip">
              <Text>{children}</Text>
            </View>
          );
        }
        const App = () => <Chip>Test Chip</Chip>;
      `);
    });

    it("suppresses an arrow wrapper forwarding props.children into a nested Text", () => {
      expectPass(`
        const Badge = (props) => (
          <View style={props.style}>
            <Text>{props.children}</Text>
          </View>
        );
        const App = () => <Badge>New</Badge>;
      `);
    });

    it("suppresses a forwardRef/memo wrapper forwarding children into a nested Text", () => {
      expectPass(`
        import { forwardRef, memo } from "react";
        const Chip = memo(
          forwardRef(({ children }, ref) => (
            <View ref={ref}>
              <Text>{children}</Text>
            </View>
          )),
        );
        const App = () => <Chip>Test Chip</Chip>;
      `);
    });

    it("suppresses a wrapper with a conditional return", () => {
      expectPass(`
        const Chip = ({ children, isLoading }) =>
          isLoading ? <Spinner /> : (
            <View>
              <Text>{children}</Text>
            </View>
          );
        const App = () => <Chip>Test Chip</Chip>;
      `);
    });

    it("suppresses a wrapper returning a fragment with a nested Text", () => {
      expectPass(`
        const Chip = ({ children }) => (
          <>
            <Icon />
            <Text>{children}</Text>
          </>
        );
        const App = () => <Chip>Test Chip</Chip>;
      `);
    });

    // Named `<Fragment>` / `<React.Fragment>` are render-transparent like the
    // shorthand `<>`, so forwarding children through one into a host still
    // crashes (fires) and forwarding into a Text still suppresses.
    it("fires on a wrapper forwarding children into a View through a named Fragment", () => {
      expectFail(`
        const Chip = ({ children }) => (
          <View>
            <Fragment>{children}</Fragment>
          </View>
        );
        const App = () => <Chip>Test Chip</Chip>;
      `);
    });

    it("suppresses a wrapper forwarding children into a Text through a React.Fragment", () => {
      expectPass(`
        const Chip = ({ children }) => (
          <View>
            <React.Fragment>
              <Text>{children}</Text>
            </React.Fragment>
          </View>
        );
        const App = () => <Chip>Test Chip</Chip>;
      `);
    });

    it("suppresses a wrapper with renamed destructured children", () => {
      expectPass(`
        const Chip = ({ children: content }) => (
          <View>
            <Text>{content}</Text>
          </View>
        );
        const App = () => <Chip>Test Chip</Chip>;
      `);
    });

    it("suppresses a wrapper using the children prop form on Text", () => {
      expectPass(`
        const Chip = ({ children }) => (
          <View>
            <Text children={children} />
          </View>
        );
        const App = () => <Chip>Test Chip</Chip>;
      `);
    });

    it("suppresses a wrapper with a return inside an if branch", () => {
      expectPass(`
        function Chip({ children, compact }) {
          if (compact) {
            return <Text>{children}</Text>;
          }
          return (
            <View>
              <Text>{children}</Text>
            </View>
          );
        }
        const App = () => <Chip>Test Chip</Chip>;
      `);
    });

    it("suppresses a wrapper that forwards children through another in-file wrapper", () => {
      expectPass(`
        const Chip = ({ children }) => (
          <View>
            <Text>{children}</Text>
          </View>
        );
        const Badge = ({ children }) => <Chip>{children}</Chip>;
        const App = () => <Badge>New</Badge>;
      `);
    });

    // Declaration order reversed: an early pass classifies `Badge` as a
    // non-text wrapper (it forwards children into the not-yet-known `Chip`),
    // then a later pass promotes it to a text wrapper once `Chip` is known. The
    // final settle must drop the stale non-text classification so `Badge` isn't
    // reported.
    it("suppresses a forwarder declared before the wrapper it forwards into", () => {
      expectPass(`
        const Badge = ({ children }) => <Chip>{children}</Chip>;
        const Chip = ({ children }) => (
          <View>
            <Text>{children}</Text>
          </View>
        );
        const App = () => <Badge>New</Badge>;
      `);
    });

    it("suppresses a wrapper that aliases children to a variable", () => {
      expectPass(`
        function Chip({ children }) {
          const content = children;
          return (
            <View>
              <Text>{content}</Text>
            </View>
          );
        }
        const App = () => <Chip>Test Chip</Chip>;
      `);
    });

    it("suppresses a wrapper that destructures children from props in the body", () => {
      expectPass(`
        const Chip = (props) => {
          const { children } = props;
          return (
            <View>
              <Text>{children}</Text>
            </View>
          );
        };
        const App = () => <Chip>Test Chip</Chip>;
      `);
    });

    it("suppresses a wrapper spreading props onto a nested Text", () => {
      expectPass(`
        const Chip = (props) => (
          <View>
            <Text {...props} />
          </View>
        );
        const App = () => <Chip>Test Chip</Chip>;
      `);
    });

    it("suppresses a wrapper spreading an object rest that carries children", () => {
      expectPass(`
        const Chip = ({ style, ...rest }) => (
          <View style={style}>
            <Text {...rest} />
          </View>
        );
        const App = () => <Chip>Test Chip</Chip>;
      `);
    });

    it("still fires when the spread rest excludes children", () => {
      expectFail(`
        const Chip = ({ children, ...rest }) => (
          <View>
            <Text {...rest} />
            {children}
          </View>
        );
        const App = () => <Chip>Test Chip</Chip>;
      `);
    });

    it("suppresses a class component forwarding this.props.children into a Text", () => {
      expectPass(`
        class Chip extends React.Component {
          render() {
            return (
              <View>
                <Text>{this.props.children}</Text>
              </View>
            );
          }
        }
        const App = () => <Chip>Test Chip</Chip>;
      `);
    });

    it("suppresses a styled(Text) factory component", () => {
      expectPass(`
        const FancyChip = styled(Text)\`
          color: red;
        \`;
        const App = () => <FancyChip>Test Chip</FancyChip>;
      `);
    });

    it("suppresses a styled.Text factory component", () => {
      expectPass(`
        const FancyCopy = styled.Text({ color: "red" });
        const App = () => <FancyCopy>Test Chip</FancyCopy>;
      `);
    });

    it("still fires for a styled(View) factory component", () => {
      expectFail(`
        const Card = styled(View)\`
          padding: 4px;
        \`;
        const App = () => <Card>Test Chip</Card>;
      `);
    });

    it("still fires when one branch renders children outside a Text", () => {
      expectFail(`
        const Chip = ({ children, inline }) => {
          if (inline) return <View>{children}</View>;
          return (
            <View>
              <Text>{children}</Text>
            </View>
          );
        };
        const App = () => <Chip>Test Chip</Chip>;
      `);
    });

    // `Chip` renders `item.children`, never its own `children` prop, so the raw
    // text passed as `<Chip>Test Chip</Chip>` renders nowhere — no crash. Chip
    // forwards no children into a non-text host, so it isn't a report target.
    it("does not fire when the component ignores its children prop (unrelated destructure)", () => {
      expectPass(`
        const Chip = ({ item }) => {
          const { children } = item;
          return (
            <View>
              <Text>{children}</Text>
            </View>
          );
        };
        const App = () => <Chip>Test Chip</Chip>;
      `);
    });

    it("does not fire when the component ignores its children prop (unrelated member)", () => {
      expectPass(`
        const Chip = ({ item }) => (
          <View>
            <Text>{item.children}</Text>
          </View>
        );
        const App = () => <Chip>Test Chip</Chip>;
      `);
    });

    it("still fires when one branch spreads props onto a non-text element", () => {
      expectFail(`
        const Chip = (props) => {
          if (props.inline) return <View {...props} />;
          return (
            <View>
              <Text>{props.children}</Text>
            </View>
          );
        };
        const App = () => <Chip>Test Chip</Chip>;
      `);
    });

    it("does not treat a render-prop's Text as the wrapper's own markup", () => {
      expectFail(`
        const Box = ({ children, renderLabel }) => (
          <View>
            <Pressable>{() => <Text>{children}</Text>}</Pressable>
            {children}
          </View>
        );
        const App = () => <Box>Hello</Box>;
      `);
    });

    it("still fires when the nested Text receives something other than children", () => {
      expectFail(`
        const Card = ({ title, children }) => (
          <View>
            <Text>{title}</Text>
            {children}
          </View>
        );
        const App = () => <Card title="hi">Body copy</Card>;
      `);
    });
  });

  // A raw-text child only crashes at a host boundary, so the rule reports it
  // only inside a known React Native host primitive, a lowercase intrinsic, or
  // an in-file component proven to forward its children outside a `<Text>`. An
  // imported custom component is left alone — whether it wraps its children in
  // `<Text>` is invisible across files, so reporting it would be a false
  // positive.
  describe("conservative report targets", () => {
    // The reported false positive: a custom button imported from another file
    // that wraps its label in `<Text>` internally. We can't see that, but we
    // also must not assume it crashes.
    it("does not fire on an imported custom button", () => {
      expectPass(`
        import { MyButton } from "./my-button";
        const App = () => <MyButton>Click me</MyButton>;
      `);
    });

    it("does not fire on an imported custom component with a template-literal child", () => {
      expectPass(`
        import { Card } from "./ui";
        const App = ({ name }) => <Card>{\`Hi \${name}\`}</Card>;
      `);
    });

    it("still fires inside every React Native host primitive", () => {
      for (const hostComponent of [
        "View",
        "ScrollView",
        "SafeAreaView",
        "KeyboardAvoidingView",
        "ImageBackground",
        "Modal",
        "Pressable",
        "TouchableOpacity",
        "TouchableHighlight",
        "TouchableWithoutFeedback",
        "TouchableNativeFeedback",
      ]) {
        expectFail(`const App = () => <${hostComponent}>Hello</${hostComponent}>;`);
      }
    });

    // `Animated.View` resolves to its `View` member, so wrapped host primitives
    // are still treated as host boundaries.
    it("still fires inside an Animated host primitive", () => {
      expectFail(`const App = () => <Animated.View>Hello</Animated.View>;`);
    });

    it("still fires inside a lowercase intrinsic", () => {
      expectFail(`const App = () => <div>Hello</div>;`);
    });

    it("still fires on an in-file component proven to render children outside Text", () => {
      expectFail(`
        const Box = ({ children }) => <View>{children}</View>;
        const App = () => <Box>Hello</Box>;
      `);
    });

    // An in-file forwarder into an imported component is as un-analyzable as the
    // import itself — the import may wrap the children in `<Text>` — so it must
    // not be flagged either, the same false positive avoided for direct usage.
    it("does not fire on an in-file forwarder into an imported component", () => {
      expectPass(`
        import { MyButton } from "./my-button";
        const Label = ({ children }) => <MyButton>{children}</MyButton>;
        const App = () => <Label>Click me</Label>;
      `);
    });

    it("does not fire on an in-file forwarder that spreads props onto an imported component", () => {
      expectPass(`
        import { BaseButton } from "./base-button";
        const PrimaryButton = (props) => <BaseButton {...props} />;
        const App = () => <PrimaryButton>Save</PrimaryButton>;
      `);
    });

    // Transitive: `Box` is proven to render children inside a `<View>`, so a
    // forwarder into `Box` renders them outside `<Text>` too — a certain crash.
    it("still fires on a forwarder into a proven non-text wrapper", () => {
      expectFail(`
        const Box = ({ children }) => <View>{children}</View>;
        const Badge = ({ children }) => <Box>{children}</Box>;
        const App = () => <Badge>New</Badge>;
      `);
    });
  });

  // Transparent wrappers (`<fbt>`, `<Fragment>`) render no host view of their
  // own, so the "inside a <Text>" check must step through them. The transparent
  // set is config-independent on purpose — i18n `<Trans>` / `<FormattedMessage>`
  // are NOT here (their RN wrapper is a provider-config choice).
  describe("transparent wrappers", () => {
    it("does not fire on an fbt nested inside a Fragment inside a Text", () => {
      expectPass(`
        const App = () => (
          <Text>
            <Fragment>
              <fbt desc="greeting">Hello</fbt>
            </Fragment>
          </Text>
        );
      `);
    });

    it("does not fire on an fbt nested inside a React.Fragment inside a Text", () => {
      expectPass(`
        const App = () => (
          <Text>
            <React.Fragment>
              <fbt desc="greeting">Hello</fbt>
            </React.Fragment>
          </Text>
        );
      `);
    });

    it("still fires on a bare fbt that is not inside a Text", () => {
      expectFail(`
        const App = () => (
          <View>
            <fbt desc="greeting">Hello</fbt>
          </View>
        );
      `);
    });
  });

  describe("test-noise suppression", () => {
    it("does not fire in testlike files", () => {
      const result = runRule(rnNoRawText, `const App = () => <View>Hello</View>;`, {
        filename: "Chip.test.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe("expo universal ui ListItem", () => {
    it("does not fire on raw text headline children of an @expo/ui ListItem", () => {
      expectPass(`
        import { Host, List, ListItem } from "@expo/ui";
        const App = () => (
          <Host>
            <List>
              <ListItem onPress={() => {}}>Settings</ListItem>
            </List>
          </Host>
        );
      `);
    });

    it("does not fire on a template-literal headline", () => {
      expectPass(`
        import { List, ListItem } from "@expo/ui";
        const App = ({ id }) => <List><ListItem>{\`Item #\${id}\`}</ListItem></List>;
      `);
    });

    it("does not fire on raw text inside compound slot markers", () => {
      expectPass(`
        import { ListItem } from "@expo/ui";
        const App = () => (
          <ListItem onPress={() => {}}>
            <ListItem.Supporting>Richer slot content</ListItem.Supporting>
          </ListItem>
        );
      `);
    });

    it("does not fire on a platform-specific @expo/ui subpath import", () => {
      expectPass(`
        import { ListItem } from "@expo/ui/swift-ui";
        const App = () => <ListItem>Profile</ListItem>;
      `);
    });

    it("does not fire on a namespace import", () => {
      expectPass(`
        import * as ExpoUI from "@expo/ui";
        const App = () => <ExpoUI.ListItem>Settings</ExpoUI.ListItem>;
      `);
    });

    // Member access off a named import resolves to a custom component name
    // (`ListItem`) we can't analyze across files — not a host boundary, so the
    // conservative default leaves it alone rather than guessing it crashes.
    it("does not fire on member access off a named @expo/ui import", () => {
      expectPass(`
        import { Row } from "@expo/ui";
        const App = () => <Row.ListItem>text</Row.ListItem>;
      `);
    });

    it("does not fire on a renamed ListItem import", () => {
      expectPass(`
        import { ListItem as Row } from "@expo/ui";
        const App = () => <Row>Profile</Row>;
      `);
    });

    // A ListItem imported from a non-`@expo/ui` module is a custom component we
    // can't see — it may well wrap its children in `<Text>` — so it's no longer
    // reported. Projects that know it crashes can name it in config.
    it("does not fire on a same-named ListItem imported from elsewhere", () => {
      expectPass(`
        import { ListItem } from "./ui";
        const App = () => <ListItem>Settings</ListItem>;
      `);
    });

    it("does not fire on an undeclared ListItem", () => {
      expectPass(`const App = () => <ListItem>Settings</ListItem>;`);
    });

    // `Row` is a custom `@expo/ui` component we don't model — not a host
    // boundary — so its raw text is left alone under the conservative default.
    it("does not fire on raw text in a non-ListItem @expo/ui layout child", () => {
      expectPass(`
        import { ListItem, Row } from "@expo/ui";
        const App = () => <ListItem><Row>raw headline</Row></ListItem>;
      `);
    });
  });
});
