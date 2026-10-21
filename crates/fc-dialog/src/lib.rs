//! Pure keyboard-dismissal decisions for Dialog host bindings.
//!
//! A native modal host owns its cancel event. A host that cannot open a requested
//! modal can instead ask this model whether an event from its inline fallback
//! requests dismissal. Focus, inertness, event propagation and the controlled
//! `open` state remain the host's responsibility. This crate touches no DOM and
//! has no script boundary, allocation or runtime dependency.
#![no_std]
#![forbid(unsafe_code)]

/// How the host is presenting the dialog.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
#[non_exhaustive]
pub enum Presentation {
    /// Native modal behavior owns keyboard cancellation.
    NativeModal,
    /// A requested modal is inline because native modal support is unavailable.
    FallbackModal,
    /// The consumer explicitly requested nonmodal presentation.
    #[default]
    NonModal,
}

/// The keyboard input relevant to dismissal.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
#[non_exhaustive]
pub enum Key {
    /// Escape can request dismissal of an unsupported-modal fallback.
    Escape,
    /// All other keys belong to the focused control or its host.
    #[default]
    Other,
}

/// Host event state after descendant controls have had their opportunity to act.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct KeyEvent {
    /// The normalized key.
    pub key: Key,
    /// A descendant already consumed this event's default action.
    pub default_prevented: bool,
    /// The event is part of an in-progress composition.
    pub composing: bool,
}

/// What the host should do with the event.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
#[non_exhaustive]
pub enum Dismissal {
    /// Preserve the existing native or descendant behavior.
    #[default]
    Ignore,
    /// Consume Escape and request that the owner close the controlled dialog.
    ///
    /// The host prevents the default action and stops propagation before calling
    /// its close-request callback, so an outer fallback does not also dismiss.
    /// The owner decides whether to change `open`; no form changes are applied.
    RequestClose,
}

/// Classify a bubbling key event from inside the dialog.
///
/// Native modal cancellation stays on the host's cancel-event path. Explicitly
/// nonmodal dialogs do not acquire modal semantics. A default-prevented event or
/// active composition belongs to its child control, including a nested overlay.
///
/// ```
/// use fc_dialog::{on_key, Dismissal, Key, KeyEvent, Presentation};
/// let event = KeyEvent { key: Key::Escape, ..KeyEvent::default() };
/// assert_eq!(on_key(true, Presentation::FallbackModal, event), Dismissal::RequestClose);
/// ```
#[must_use]
pub fn on_key(open: bool, presentation: Presentation, event: KeyEvent) -> Dismissal {
    if open
        && presentation == Presentation::FallbackModal
        && event.key == Key::Escape
        && !event.default_prevented
        && !event.composing
    {
        Dismissal::RequestClose
    } else {
        Dismissal::Ignore
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn escape() -> KeyEvent {
        KeyEvent {
            key: Key::Escape,
            ..KeyEvent::default()
        }
    }

    #[test]
    fn open_modal_fallback_requests_close() {
        assert_eq!(
            on_key(true, Presentation::FallbackModal, escape()),
            Dismissal::RequestClose
        );
    }

    #[test]
    fn closed_fallback_does_not_request_close() {
        assert_eq!(
            on_key(false, Presentation::FallbackModal, escape()),
            Dismissal::Ignore
        );
    }

    #[test]
    fn native_modal_keeps_its_cancel_event_path() {
        assert_eq!(
            on_key(true, Presentation::NativeModal, escape()),
            Dismissal::Ignore
        );
    }

    #[test]
    fn explicitly_nonmodal_is_not_promoted() {
        assert_eq!(
            on_key(true, Presentation::NonModal, escape()),
            Dismissal::Ignore
        );
    }

    #[test]
    fn other_keys_keep_control_behavior() {
        assert_eq!(
            on_key(true, Presentation::FallbackModal, KeyEvent::default()),
            Dismissal::Ignore
        );
    }

    #[test]
    fn child_consumed_escape_is_not_reused() {
        let event = KeyEvent {
            default_prevented: true,
            ..escape()
        };
        assert_eq!(
            on_key(true, Presentation::FallbackModal, event),
            Dismissal::Ignore
        );
    }

    #[test]
    fn composition_keeps_its_escape() {
        let event = KeyEvent {
            composing: true,
            ..escape()
        };
        assert_eq!(
            on_key(true, Presentation::FallbackModal, event),
            Dismissal::Ignore
        );
    }

    #[test]
    fn nested_fallback_consumes_before_the_outer_one() {
        let event = escape();
        let inner = on_key(true, Presentation::FallbackModal, event);
        assert_eq!(inner, Dismissal::RequestClose);
        let outer_event = KeyEvent {
            default_prevented: inner == Dismissal::RequestClose,
            ..event
        };
        assert_eq!(
            on_key(true, Presentation::FallbackModal, outer_event),
            Dismissal::Ignore
        );
    }
}
