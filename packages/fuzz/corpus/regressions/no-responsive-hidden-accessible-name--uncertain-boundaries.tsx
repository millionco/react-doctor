// rule: no-responsive-hidden-accessible-name
// weakness: dynamic-computed
// source: adversarial audit of deterministic design rules
// verdict: pass

const Button = condition ? "div" : "span";

export const ResponsiveNames = () => (
  <Composer
    action={
      condition ? (
        <button>
          <span className="md:hidden">Save</span>
        </button>
      ) : null
    }
  >
    <Button>
      <span className="md:hidden">Not a control</span>
    </Button>
    <button inert>
      <span className="md:hidden">Inactive</span>
    </button>
    <button>
      <span data-state="open" className="md:hidden data-[state=open]:block">
        Still named
      </span>
    </button>
  </Composer>
);
