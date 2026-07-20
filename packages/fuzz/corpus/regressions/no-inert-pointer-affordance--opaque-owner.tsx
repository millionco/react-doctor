// rule: no-inert-pointer-affordance
// weakness: opaque-component
// source: PR #1337 all-rules RDE parity (payloadcms/payload, PostHog/posthog)
export const LinkedImage = () => (
  <Link href="/products/widget">
    <div className="cursor-pointer">Widget</div>
  </Link>
);

export const ColorPicker = () => (
  <Picker customButton={<span className="cursor-pointer">Color</span>} />
);

export const ImperativeControl = () => (
  <div ref={controlRef} className="cursor-pointer">
    Open
  </div>
);

export const NestedControl = () => (
  <div className="cursor-pointer">
    <button>Open</button>
  </div>
);

export const NestedDelegatedControl = () => (
  <ul className="cursor-pointer">
    <li onClick={select}>Select</li>
  </ul>
);

export const NestedOpaqueControl = () => (
  <div className="cursor-pointer">
    <OverlayTrigger />
  </div>
);

export const ConditionalNestedControl = () => (
  <div className="cursor-pointer">{isOpen && <button>Close</button>}</div>
);

export const MappedNestedControls = () => (
  <ul className="cursor-pointer">
    {items.map((item) => (
      <li key={item.id} onClick={() => select(item)}>
        {item.label}
      </li>
    ))}
  </ul>
);
