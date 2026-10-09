# RustyClaw semantic coverage

Audited 2026-10-09 against [rexlunae/RustyClaw](https://github.com/rexlunae/RustyClaw/tree/481a428cb7a3b82d1a5e556ffef40e3dd9f52ce3), commit `481a428cb7a3b82d1a5e556ffef40e3dd9f52ce3`.
Scope: desktop component modules, terminal component modules and shared view models.
This is a source audit, not a claim that RustyClaw has adopted future-css or that its native clients were run. CSS supplies equivalent web semantics; terminal glyph geometry is not a CSS contract.

## Coverage map

Paths below are relative to `crates/rustyclaw-desktop/src/components/` unless marked TUI or view. A screen composes components; a screen name alone is not a reason to add another CSS file.

| RustyClaw source / elements | future-css coverage | Decision |
| --- | --- | --- |
| `mod.rs`: modal shell, heading, close, footer | dialog, button | Native `dialog.showModal()` for focus containment, Escape and restoration; existing dialog recipes |
| `chat.rs`: transcript, authors, attachments, send/stop, empty starters | chat, avatar, composer, tag, suggestion, empty-state, agent-status, tool-call, reasoning, citation | Existing; retain message/runtime IDs and ordering |
| `composer_accessory.rs`: directory, provider/model selectors | context-strip, select, input-group, button | Existing; provider/model state belongs to one binding |
| `sidebar.rs`: brand, collapse, connection state, projects, threads, menus, counts | masthead, nav, disclosure, menu, badge, agent-status | Nested disclosures and lists preserve hierarchy without claiming an ARIA tree keyboard model |
| `connection.rs`: URL, history, pin/remove, auto-connect, error/copy/retry | field, list, button with aria-pressed, check, alert, spinner | Existing; full URL reachable, accessible action names |
| `credential_request.rs`, `vault_unlock.rs`, TUI `api_key_dialog`, `auth_dialog`: passwords, tokens, TOTP | dialog, field, input-group, button, alert | Password input; TOTP is one labeled text input with inputmode=numeric and autocomplete=one-time-code; no secret attributes |
| `device_flow.rs`: verification link, code, expiry/wait | **device-auth**, button, agent-status | New reusable authorization content, hosted in a dialog or page |
| `pairing.rs`: public key/fingerprint, QR, host/port, connection phases | device-auth, code, field, button, progress, alert | QR is an optional image with a text/link alternative; renderer supplied by host, no new QR dependency |
| `hatching.rs`: agent name/personality | dialog, field, button | Existing native form |
| `new_project.rs`, `edit_dialogs.rs`, `dir_picker.rs`: names, folder picker, inheritance toggle | dialog, field/input-group, check, select, button | Native host folder picker or editable path fallback; no fake browser filesystem access |
| `user_prompt.rs`: text, confirm, single/multiple choice, multi-field questions, dismiss | **user-prompt**, field, check, multiselect, button | New named inline form, all five input types; never intercept Enter on another action |
| `tool_approval.rs`: requested operation, full arguments, allow/deny | **approval**, disclosure, code, button | New approval content with full inspection and explicit scope; pending does not imply permission |
| `approvals.rs`: queue and request status | table, approval, badge, empty-state | Existing queue composition plus new request content |
| `analytics.rs`: totals, latency, per-model and per-session tables | **metric**, table, empty-state | New scalar summary with exact machine-readable native data value |
| `downloads.rs`: destination, known/unknown size, progress, cancel, error, duration | **transfer**, progress, button, alert | New persistent transfer item; unknown totals omit value; no per-byte live announcements |
| `engines.rs`: engine tabs, state/version, model list, install output, pulls, parameter editor | tabs, list/table, badge, transfer, terminal, field, check, button, alert | Existing management composition; transfer covers model pulls |
| `gateway_control.rs`: local/remote scope, process identity, start/stop/reload, outcome | card, description-list, badge, button, alert | Explicit separate named local and remote sections |
| `system_info.rs`: hardware, load, thresholds | description-list, metric, progress, badge | Existing + metric; label thresholds rather than communicating only by color |
| `logs.rs`: level, time, logger, message | terminal, toolbar, select, button | Existing; pause live follow and avoid logging secrets |
| `mcp.rs`: server inventory and connection states | table, badge, button, empty-state | Existing |
| `memory.rs`: categories, scores, updated time, content | table, badge, disclosure | Full memory text reachable; previews declare truncation |
| `messengers.rs`, `channels.rs`: accounts, channel/routes, edit/pick forms, status | table, list, badge, field, select, check, dialog | Existing |
| `cron.rs`: name, schedule, prompt, provider/model/thread, run/pause/edit/delete | table, field, context-strip, select, button, dialog, badge | Existing; schedule is explicit text with help, not an invented calendar value |
| `secrets.rs`: inventory, policy, reveal challenge, values, add/delete | table, badge, field, dialog, button, alert, code | Existing; sensitive values only in text/input properties, reveal lifecycle belongs to host |
| `services.rs`: managed services, health, ports | table, badge, description-list, empty-state | Existing |
| `settings.rs`: credentials, provider definitions, appearance, reconnect | field, input-group, theme-picker, button-group, dialog, alert | Existing |
| `skills.rs`, `tools_config.rs`, TUI `tool_perms_dialog`: enablement and permissions | table, check/switch, badge, button, select | Existing; native checked/disabled state |
| `swarm_panel.rs`: swarm cards, member roles/state, counts, stop/create | card, list, agent-status, badge, button, approval | Existing; textual member hierarchy rather than decorative topology |
| `plugin_panel.rs`: tabs, title, refresh/actions, arbitrary JSON values | tabs, card, description-list, list, code, empty-state | Existing; render untrusted values as text |
| TUI `command_menu`, view `command_palette`, provider/model/agent selectors | search, menu, select, dialog | Existing; use menu binding for commands, select for values; no unsupported combobox role |
| TUI `thread_tabs`, `input_bar`, `status_bar`, messages/tool call/details | tabs, composer, context-strip, agent-status, chat, tool-call, disclosure | Existing |
| View `file_browser`: nested files/directories, expansion and selected path | nav, disclosure, list, button | Native nested details recipe; selected document uses aria-current, not a fake tree |
| View `preview`: Markdown/HTML/image/PDF/plain text and follow/error | card, toolbar, code, webview, alert; native figure/img/object | Existing shell. Host sanitizes Markdown/HTML and sandboxes HTML previews; CSS does not make content safe |
| View `media`, `voice`: image/audio/video, recording/playback state | card, composer, button, agent-status; native audio/video | Native media controls retain keyboard/caption support; host provides capture and media data |
| Website `website/index.html`: navigation, hero/install command, feature cards and links | masthead, nav, button, code, card, list, type/layout | Existing general website primitives |

Try the [working local form recipes](../demo/rustyclaw.html) with `npm run demo`, or inspect [all lifecycle fixtures](../demo/fixtures.html#fx-metric).

## New component contracts

Each new file is independently loadable, under 7 KB minified, registered in the bundle, documented in COMPONENTS and COMPONENT-CONTRACTS, and represented in all eight lifecycle states in the fixture page. No WASM or new dependencies are needed.

- `metric`: a label and exact value (`dl`/`dt`/`dd`, optionally native `data`) plus period/source. Format display with Intl. Unknown data is “Unavailable”, never zero.
- `transfer`: named item, full destination, byte/time metadata, named native progress and host-owned cancel/retry. Keep completed records inspectable.
- `approval`: named operation, scope, full arguments in native details, explicit deny/allow actions. Host must invalidate stale approvals and disable resolved actions. Never place arguments or credentials in attributes.
- `user-prompt`: named inline form with labeled fields, legends and native validation. Text, confirm (two submit buttons), radio, checkbox and multi-field variants compose the existing controls. Form submission and dismissal remain application decisions; no focus stealing or global keyboard shortcut is required.
- `device-auth`: verification link, selectable isolated code, expiry and state text. Polling, trusted URL validation and code cleanup belong to the host. Pairing may include an optional QR with the same textual destination.

Use data-fc-kind/id/seq/state/ts on dynamic roots, role on message nodes, and data-fc-truncated=true only when eliding text with a full-value path. Absent metadata still renders readable content. Lifecycle styling adds boundary cues; visible text is always required. No new color pair is introduced: default/muted text on surface, accent/danger boundaries and focus on surface reuse declared contrast pairs.

## RustyClaw defects filed

- [#493: full approval arguments unavailable](https://github.com/rexlunae/RustyClaw/issues/493)
- [#494: desktop clipboard portability and ignored exit status](https://github.com/rexlunae/RustyClaw/issues/494)
- [#495: inline question inputs lack associated labels](https://github.com/rexlunae/RustyClaw/issues/495)

These are source-confirmed findings with reproduction instructions, not claims of a native runtime test.

## Verification

`FC_AXE_SOURCE=/tmp/fc-validation-tools/node_modules/axe-core/axe.min.js npm run check`
passed on 2026-10-09: 521 JavaScript/browser tests, 133 Rust tests, zero skips.
Chrome exercised the new fixture states at 320px in both schemes/directions,
focus rings, forced colors and reduced motion. Axe reported no serious/critical
findings across fixtures, the main demo and RustyClaw recipes. A separate targeted
browser pass also verified recipe overflow at 320px after adding that assertion.
New components measure 1.2–1.4 KB minified each, under the unchanged 7 KB budget.
Native RustyClaw execution and manual screen-reader review were not performed.
