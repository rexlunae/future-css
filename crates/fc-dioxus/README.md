# fc-dioxus

A Dioxus component library built on future-css, in the spirit of `dioxus-bulma`, with
accessibility enforced by its types and checked by its own tooling.

**Status: design only.** Nothing here compiles yet; the documents describe the target and
the plan to reach it.

| Document | What it covers |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Rules for anyone, human or agent, changing these crates |
| [docs/DESIGN.md](docs/DESIGN.md) | Architecture, crates, shared building blocks, conventions, testing |
| [docs/COMPONENTS.md](docs/COMPONENTS.md) | The Rust API for every CSS component and every option |
| [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md) | How WCAG 2.2 AA is enforced, and the `fc-a11y` compliance tools |
| [docs/PLAN.md](docs/PLAN.md) | Phases, exit gates, open decisions, risks |

A taste of the target API:

```rust
use fc_dioxus::prelude::*;

#[component]
fn Toolbar() -> Element {
    rsx! {
        FutureCss { theme: Theme::System,
            Cluster { gap: ClusterGap::S2,
                Button { variant: ButtonVariant::Primary, onclick: save, "Save" }
                // An icon-only button without a label does not compile.
                IconButton { label: "Close", icon: rsx! { CloseIcon {} } }
            }
        }
    }
}
```
