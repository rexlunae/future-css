//! fc-core — the shared runtime for future-css WASM components.
//!
//! # Why this crate exists
//!
//! Every future-css WASM component needs the same three things: a panic hook, a
//! version handshake with the JS side, and a structured error type. That is all
//! this crate contains. It is the most expensive crate in the workspace per byte
//! of functionality, because every consumer of every component links it.
//!
//! Two rules follow from that. No component-specific logic belongs here, however
//! tempting — a helper only rich text uses belongs in fc-rich-text, duplicated
//! if a second component later needs it. And no dependency on any sibling crate:
//! the arrow points down only.
//!
//! # The versioning handshake
//!
//! A CSS framework and a WASM module are versioned together, but a consumer
//! upgrades them independently and often loads the `.wasm` from a CDN or a
//! service-worker cache. If the JS layer and the module drift out of sync the
//! failure mode is a wrong-but-plausible result rather than a crash, which is
//! much worse to debug. [`abi_version`] makes that mismatch fail loudly on the
//! first call instead.
//!
//! CSS and WASM are versioned separately on purpose: the CSS must work with no
//! WASM at all, so bumping one must never force a bump of the other. The
//! handshake covers the seam between them.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// The ABI version of this core module.
///
/// Increment whenever a change alters the meaning or shape of anything crossing
/// the JS boundary. The JS layer asserts equality against this value.
pub const ABI_VERSION: u32 = 1;

/// Reported to JavaScript on load. Cheap, and the first thing to check when
/// diagnosing a misbehaving integration.
#[wasm_bindgen(js_name = abiVersion)]
pub fn abi_version() -> u32 {
    ABI_VERSION
}


/// Installs a panic hook that prints a readable message to the console.
///
/// Without this, a Rust panic in a release build surfaces to JS as
/// "unreachable", which tells a user nothing. With `panic = "abort"` and release
/// optimization this is the only diagnostic that exists, so it is called
/// unconditionally at init rather than left to the consumer.
#[wasm_bindgen(js_name = initPanicHook)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

/// Normalizes a text offset pair into a half-open range `[start, end)`.
///
/// Half-open is the convention throughout the workspace: it composes with
/// slicing, and `start == end` naturally expresses a caret rather than needing a
/// separate "is this a selection" flag.
///
/// A backwards range is an error rather than a silent swap. A caller computing
/// one has a bug, and quietly fixing it hides that bug while surfacing its
/// symptom somewhere unrelated.
pub fn normalize_range(start: usize, end: usize) -> Result<(usize, usize), FcError> {
    if end < start {
        return Err(FcError::InvalidInput {
            message: format!("range end ({end}) precedes start ({start})"),
        });
    }
    Ok((start, end))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn abi_version_matches_the_exported_constant() {
        // Guards against the constant and the export drifting apart, which would
        // make the handshake check vacuous.
        assert_eq!(abi_version(), ABI_VERSION);
    }

    #[test]
    fn normalize_range_accepts_forward_and_empty_ranges() {
        assert_eq!(normalize_range(0, 5).unwrap(), (0, 5));
        // A caret is the empty range, not a special case.
        assert_eq!(normalize_range(3, 3).unwrap(), (3, 3));
    }

    #[test]
    fn normalize_range_rejects_backwards_ranges() {
        let err = normalize_range(5, 2).unwrap_err();
        assert_eq!(err.kind(), "invalidInput");
        assert!(err.message().contains("precedes"));
    }

    #[test]
    fn error_kinds_are_stable() {
        // These strings cross into JS and into logs; changing one is an ABI break.
        assert_eq!(FcError::InvalidInput { message: String::new() }.kind(), "invalidInput");
        assert_eq!(FcError::Unsupported { message: String::new() }.kind(), "unsupported");
        assert_eq!(FcError::OutOfBounds { message: String::new() }.kind(), "outOfBounds");
    }
}

/// The structured error every crate in the workspace returns across the
/// boundary.
///
/// A `String` across a WASM boundary loses the distinction between "the user
/// typed something invalid" and "we have a bug", and those need different
/// handling at each end. This is serialized rather than thrown so the JS side
/// can branch on `kind` without string matching.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FcError {
    /// Well-formed but semantically invalid, e.g. a range with end before
    /// start. Usually the caller's fault and worth surfacing to the user.
    InvalidInput { message: String },
    /// Cannot be satisfied in the current state, e.g. undo on an empty history.
    /// Expected in normal operation.
    Unsupported { message: String },
    /// An index outside the bounds of a document or model. Indicates a bug, so
    /// it is logged rather than displayed.
    OutOfBounds { message: String },
}

impl FcError {
    /// A short machine-readable tag, for callers that branch without parsing.
    pub fn kind(&self) -> &'static str {
        match self {
            FcError::InvalidInput { .. } => "invalidInput",
            FcError::Unsupported { .. } => "unsupported",
            FcError::OutOfBounds { .. } => "outOfBounds",
        }
    }

    /// The human-facing message, without the kind prefix.
    pub fn message(&self) -> &str {
        match self {
            FcError::InvalidInput { message }
            | FcError::Unsupported { message }
            | FcError::OutOfBounds { message } => message,
        }
    }
}

impl From<FcError> for JsValue {
    /// Converts to a JS `Error` whose message carries the kind, so a caught
    /// exception is still classified on the JS side.
    fn from(err: FcError) -> Self {
        js_sys::Error::new(&format!("fc:{}:{}", err.kind(), err.message())).into()
    }
}