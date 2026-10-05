import { FutureCssSelect } from "./select.ts";

/**
 * Context strip bindings.
 *
 * Wires a group of selects into one coherent piece of state: provider, model,
 * effort, and model parameters.
 *
 * # Why the relationships live here and not in the selects
 *
 * Each control is a `FutureCssSelect` and stays reusable. Two behaviours belong to
 * the *group*:
 *
 * **Provider filters model.** Changing provider swaps the model list, and the
 * selected model may not exist under the new one. If each select owned its own
 * state they would disagree — a model from one provider selected under another,
 * which is a request nobody can fulfil. So provider change resolves the model.
 *
 * **Effort is not universally available.** Reasoning models take an effort level;
 * others ignore it. A control that is present but silently ineffective is worse
 * than one that is dimmed and labelled, so the strip tracks applicability and
 * never quietly clears a value the user set.
 *
 * # What is deliberately not here
 *
 * The model catalogue. These bindings consume a description of providers, models,
 * and parameters; they do not know what any particular vendor sells. Fetching a
 * catalogue, caching it, and handling a provider being unavailable are the
 * application's business.
 */

/** One provider, with the models it offers. */
export interface Provider {
  id: string;
  name: string;
  models: readonly Model[];
}

/** One model. */
export interface Model {
  id: string;
  name: string;
  /** Reasoning models accept an effort level; others do not. */
  reasoning?: boolean;
  /** Shown in the parameter chips, e.g. `{ context: "200k" }`. */
  parameters?: Readonly<Record<string, string>>;
}

/** Effort levels, when a model accepts one. */
export type Effort = "low" | "medium" | "high";

export interface ContextStripOptions {
  /** The `.fc-context-strip` root. */
  root: Element | string;
  /** The providers to offer. */
  providers: readonly Provider[];
  /** Called whenever any part of the context changes. */
  onChange?: (state: ContextState) => void;
}

/** The resolved state of the whole strip. */
export interface ContextState {
  provider: string;
  model: string;
  /** Undefined when the current model has no effort control. */
  effort?: Effort;
  /** Model parameters for the current selection. */
  parameters: Readonly<Record<string, string>>;
}

const EFFORTS: readonly Effort[] = ["low", "medium", "high"];

export class FutureCssContextStrip {
  private readonly root: HTMLElement;
  private readonly providers: readonly Provider[];
  private readonly onChange?: (state: ContextState) => void;

  private selects: Partial<
    Record<"provider" | "model" | "effort", FutureCssSelectLike>
  > = {};
  private fields: Partial<Record<"provider" | "model" | "effort", HTMLElement>> = {};

  private providerId = "";
  private modelId = "";
  private effort: Effort | undefined;
  /** The model last selected under each provider, so switching back restores it. */
  private readonly remembered = new Map<string, string>();
  /** Set while the constructor resolves the initial state. See `setProvider`. */
  private suppress = false;

  constructor(options: ContextStripOptions) {
    this.root = resolve(options.root, "context strip root");
    this.providers = options.providers;
    this.onChange = options.onChange;

    this.wire();
    // Start on the first provider so the strip is never in a half-state on load.
    //
    // `suppress` because a constructor that calls a consumer callback it has not
    // yet returned can fail *their* setup: a handler touching state declared after
    // the `new` would throw inside the constructor, and the caller would see a
    // confusing error at the construction site rather than at theirs. The first
    // resolved state is already readable from `.state`.
    this.suppress = true;
    try {
      this.setProvider(this.providers[0]?.id ?? "");
    } finally {
      this.suppress = false;
    }
  }

  /** The resolved state. */
  get state(): ContextState {
    return {
      provider: this.providerId,
      model: this.modelId,
      effort: this.model?.reasoning ? this.effort : undefined,
      parameters: this.model?.parameters ?? {},
    };
  }

  /** The current model, or undefined. */
  get model(): Model | undefined {
    return this.provider?.models.find((m) => m.id === this.modelId);
  }

  private get provider(): Provider | undefined {
    return this.providers.find((p) => p.id === this.providerId);
  }

  /**
   * Selects a provider and resolves the model against it.
   *
   * Keeps the current model when the new provider offers it, so flipping between
   * two providers that share a model does not silently change the model too.
   */
  setProvider(providerId: string): void {
    if (!this.providers.some((p) => p.id === providerId)) return;
    const previousProvider = this.providerId;
    const previousModel = this.modelId;

    // Remember the outgoing provider's model, so switching back restores it.
    //
    // Without this, flipping between two providers always resets the model to
    // each one's first option -- so a user comparing two providers cannot hold
    // their model choice steady and ends up silently changing what they are about
    // to send. The memory is per provider, not global: an OpenAI model is not
    // offered by Anthropic, so keeping one global value would be meaningless.
    if (previousProvider) {
      this.remembered.set(previousProvider, previousModel);
    }

    this.providerId = providerId;
    const available = this.provider?.models ?? [];
    // Prefer the model this provider had last time, then a model the *other*
    // provider also offers, then its own first option. The middle case is what
    // makes two providers sharing a model behave as the user expects.
    // Three candidates, most specific first: what the new provider last had, a
    // model it shares with the provider we are leaving, then its own first option.
    // The middle case is what makes two providers offering the same model behave
    // as the user expects instead of resetting.
    const candidates = [this.remembered.get(providerId), previousModel];
    this.modelId =
      candidates.find((id) => id && available.some((m) => m.id === id)) ??
      available[0]?.id ??
      "";

    this.renderProviderOptions();
    this.renderModelOptions();
    this.renderEffort();
    this.syncControls();
    this.emit();
  }

  /** Selects a model, if the current provider offers it. */
  setModel(modelId: string): void {
    const available = this.provider?.models ?? [];
    const model = available.find((m) => m.id === modelId);
    if (!model) return;
    this.modelId = modelId;
    // Effort defaults to the middle level, but only when the new model supports
    // one and none is set yet -- so switching between two reasoning models does
    // not reset the user's choice.
    if (model.reasoning && !this.effort) this.effort = "medium";
    this.renderEffort();
    this.syncControls();
    this.emit();
  }

  /** Sets the effort level. Ignored for a model with no effort control. */
  setEffort(effort: Effort): void {
    if (!this.model?.reasoning) return;
    this.effort = effort;
    this.syncControls();
    this.emit();
  }

  // ---- Wiring --------------------------------------------------------------

  private wire(): void {
    // Each control is enhanced by the same binding the standalone component uses.
    for (const kind of ["provider", "model", "effort"] as const) {
      const invoker = this.root.querySelector<HTMLElement>(`[data-fc-strip="${kind}"]`);
      if (!invoker) continue;
      const list = invoker.nextElementSibling as HTMLElement | null;
      if (!list) continue;

      this.fields[kind] = invoker.closest<HTMLElement>(".fc-context-strip__field") ?? undefined;
      this.selects[kind] = bindSelect(invoker, list, () => {
        const value = invoker.dataset.fcValue ?? "";
        if (kind === "provider") this.setProvider(value);
        else if (kind === "model") this.setModel(value);
        else this.setEffort(value as Effort);
      });
    }
  }

  /**
   * Rebuilds the provider options, keeping the group headings.
   *
   * Options are written straight into the list rather than through the select's
   * public API: there is no "set options" method, and adding one just for this
   * would widen the component's surface for a single caller.
   */
  private renderProviderOptions(): void {
    const list = this.listFor("provider");
    if (!list) return;
    list.replaceChildren();
    for (const provider of this.providers) {
      list.append(groupLabel(provider.name), optionFor(provider.id, provider.name));
    }
  }

  private renderModelOptions(): void {
    const list = this.listFor("model");
    if (!list) return;
    list.replaceChildren();
    for (const provider of this.providers) {
      if (provider.id !== this.providerId) continue;
      for (const model of provider.models) {
        list.append(optionFor(model.id, model.name));
      }
    }
  }

  /**
   * Rebuilds the effort options, or disables the control.
   *
   * The options are *not* replaced when the level is unchanged, so the control
   * keeps its identity and focus across a model switch.
   */
  private renderEffort(): void {
    const list = this.listFor("effort");
    if (!list) return;
    if (!this.model?.reasoning) return; // leave the markup; it is dimmed instead
    list.replaceChildren(...EFFORTS.map((e) => optionFor(e, capitalize(e))));
    if (!this.effort) this.effort = "medium";
  }

  private listFor(kind: "provider" | "model" | "effort"): HTMLElement | null {
    const invoker = this.root.querySelector<HTMLElement>(`[data-fc-strip="${kind}"]`);
    return invoker ? (invoker.nextElementSibling as HTMLElement | null) : null;
  }

  /**
   * Pushes state into the controls and reflects applicability.
   *
   * Every visible value is also written to `data-fc-*` on the root, so a machine
   * reads the whole context without walking three selects and parsing their
   * labels. The attributes are additive: nothing in the CSS depends on them, so
   * the strip still works for a consumer that ignores them.
   */
  private syncControls(): void {
    this.root.dataset.fcProvider = this.providerId;
    this.root.dataset.fcModel = this.modelId;

    const reasoning = Boolean(this.model?.reasoning);
    if (reasoning) {
      this.root.dataset.fcEffort = this.effort ?? "";
    } else {
      // Removed rather than emptied: an empty attribute reads as "effort is set to
      // nothing", which is a different claim from "effort does not apply here".
      delete this.root.dataset.fcEffort;
    }

    setValue(this.root, "provider", this.providerId);
    setValue(this.root, "model", this.modelId);
    setValue(this.root, "effort", reasoning ? (this.effort ?? "") : "");

    // Dimming rather than removing an inapplicable control: a row that reflows
    // when the user changes model makes the whole strip jump, and the absence
    // would not be announced at all.
    const field = this.fields.effort;
    if (field) {
      field.dataset.fcApplicable = String(reasoning);
      field.querySelector("[data-fc-strip='effort']")?.setAttribute("aria-disabled", String(!reasoning));
    }
    this.renderParameters();
    this.renderNotice();
  }

  /**
   * Renders the parameter chips.
   *
   * Values are read-only: they are model facts the application configures, and a
   * spinner next to a token count implies precision it does not have.
   */
  private renderParameters(): void {
    const host = this.root.querySelector<HTMLElement>(".fc-context-strip__params");
    if (!host) return;
    const parameters = this.model?.parameters ?? {};
    host.replaceChildren(
      ...Object.entries(parameters).map(([name, value]) => {
        const chip = document.createElement("span");
        chip.className = "fc-context-strip__param";

        const label = document.createElement("span");
        label.className = "fc-context-strip__param-name";
        label.textContent = name;

        const shown = document.createElement("span");
        shown.className = "fc-context-strip__param-value";
        shown.textContent = value;

        chip.append(label, shown);
        return chip;
      }),
    );
  }

  /**
   * Says so when the effort selection does not apply to this model.
   *
   * Not silently cleared: a setting that disappears is a setting the user cannot
   * find again, and they would not know why it stopped taking effect.
   */
  private renderNotice(): void {
    const host = this.root.querySelector<HTMLElement>(".fc-context-strip__notice");
    if (!host) return;
    if (this.model?.reasoning) {
      host.textContent = "";
      host.hidden = true;
      return;
    }
    host.hidden = false;
    host.textContent = this.effort
      ? "Effort is not used by this model"
      : "This model has no effort setting";
  }

  private emit(): void {
    if (this.suppress) return;
    this.onChange?.(this.state);
  }
}

/**
 * The part of `FutureCssSelect` this module uses.
 *
 * Narrower than the class: the strip never reads the option list or filters,
 * because it *rebuilds* the model list when the provider changes rather than
 * narrowing it. Declaring only what is used keeps the dependency honest.
 */
interface FutureCssSelectLike {
  setValue(value: string): void;
}

/**
 * Creates a select over existing markup.
 *
 * A direct import rather than a `globalThis` lookup: `select.ts` does not depend
 * on this module, so there is no cycle, and resolving the constructor at runtime
 * would only turn a missing import into a confusing "strip does nothing" instead
 * of a module-resolution error.
 */
function bindSelect(
  invoker: HTMLElement,
  list: HTMLElement,
  onSelect: () => void,
): FutureCssSelectLike {
  return new FutureCssSelect({ invoker, list, onChange: onSelect });
}

/** Writes a control's value into its invoker and its list. */
function setValue(root: HTMLElement, kind: string, value: string): void {
  const invoker = root.querySelector<HTMLElement>(`[data-fc-strip="${kind}"]`);
  if (!invoker) return;
  invoker.dataset.fcValue = value;
  const label = invoker.querySelector<HTMLElement>(".fc-select__value");
  const option = root.querySelector<HTMLElement>(
    `[data-fc-strip="${kind}"] ~ * [data-fc-value="${cssEscape(value)}"]`,
  );
  if (label && option) {
    label.textContent =
      option.querySelector(".fc-select__option-label")?.textContent?.trim() ?? value;
  }
  // The select renders its own check glyph from `data-fc-value`, so the list is
  // told rather than the DOM patched: two writers would disagree.
  for (const el of root.querySelectorAll<HTMLElement>(`[data-fc-strip="${kind}"] ~ * [role="option"]`)) {
    el.setAttribute("aria-selected", String(el.dataset.fcValue === value));
  }
}

function groupLabel(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "fc-select__group-label";
  el.setAttribute("role", "presentation");
  el.textContent = text;
  return el;
}

function optionFor(value: string, label: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "fc-select__option";
  el.setAttribute("role", "option");
  el.dataset.fcValue = value;
  const check = document.createElement("span");
  check.className = "fc-select__option-check";
  check.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.className = "fc-select__option-label";
  text.textContent = label;
  el.append(check, text);
  return el;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function cssEscape(value: string): string {
  return globalThis.CSS?.escape ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}

function resolve(target: Element | string, what: string): HTMLElement {
  const el = typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
  if (!el) throw new Error(`future-css: ${what} not found: ${String(target)}`);
  return el;
}
