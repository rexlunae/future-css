//! Theme versions: SemVer 2.0.0, matched and ordered as `theme-schema.ts` does.
//!
//! The TypeScript uses `THEME_VERSION_PATTERN`, the regex the SemVer spec
//! publishes. Anchored, it accepts exactly what this hand-written split does,
//! and the parity test checks generated strings through both.

use core::cmp::Ordering;

/// The parts of a valid version: three numeric strings and the prerelease.
struct Parts<'a> {
    core: [&'a str; 3],
    pre: Option<&'a str>,
}

fn numeric(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) && (s == "0" || !s.starts_with('0'))
}

fn alnum(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

fn split(version: &str) -> Option<Parts<'_>> {
    let (rest, build) = match version.split_once('+') {
        Some((rest, build)) => (rest, Some(build)),
        None => (version, None),
    };
    if let Some(build) = build {
        if !build.split('.').all(alnum) {
            return None;
        }
    }
    // The core has no hyphens, so the first one starts the prerelease.
    let (core, pre) = match rest.split_once('-') {
        Some((core, pre)) => (core, Some(pre)),
        None => (rest, None),
    };
    let mut numbers = core.split('.');
    let parts = [numbers.next()?, numbers.next()?, numbers.next()?];
    if numbers.next().is_some() || !parts.iter().all(|p| numeric(p)) {
        return None;
    }
    if let Some(pre) = pre {
        // An all-digit identifier is a number, and numbers have no leading zero.
        let ok = pre.split('.').all(|id| alnum(id) && (!id.bytes().all(|b| b.is_ascii_digit()) || numeric(id)));
        if !ok {
            return None;
        }
    }
    Some(Parts { core: parts, pre })
}

/// Whether `version` is SemVer, the `themeVersionPattern` test.
pub fn is_valid(version: &str) -> bool {
    split(version).is_some()
}

/// Two digit strings without leading zeros, compared as the integers they spell.
fn compare_numbers(a: &str, b: &str) -> Ordering {
    a.len().cmp(&b.len()).then_with(|| a.cmp(b))
}

/// SemVer precedence, `compareThemeVersions`. `None` when either is invalid.
pub fn compare(a: &str, b: &str) -> Option<Ordering> {
    let (left, right) = (split(a)?, split(b)?);
    for i in 0..3 {
        let order = compare_numbers(left.core[i], right.core[i]);
        if order != Ordering::Equal {
            return Some(order);
        }
    }
    let (l, r) = match (left.pre, right.pre) {
        (l, r) if l == r => return Some(Ordering::Equal),
        (None, _) => return Some(Ordering::Greater),
        (_, None) => return Some(Ordering::Less),
        (Some(l), Some(r)) => (l, r),
    };
    let (mut l, mut r) = (l.split('.'), r.split('.'));
    loop {
        match (l.next(), r.next()) {
            (None, None) => return Some(Ordering::Equal),
            (None, Some(_)) => return Some(Ordering::Less),
            (Some(_), None) => return Some(Ordering::Greater),
            (Some(x), Some(y)) if x == y => continue,
            (Some(x), Some(y)) => {
                let (xn, yn) = (x.bytes().all(|b| b.is_ascii_digit()), y.bytes().all(|b| b.is_ascii_digit()));
                return Some(match (xn, yn) {
                    (true, true) => compare_numbers(x, y),
                    (true, false) => Ordering::Less,
                    (false, true) => Ordering::Greater,
                    (false, false) => x.cmp(y),
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validity() {
        for ok in ["1.0.0", "0.0.0", "1.2.3-alpha.1", "1.0.0-0a", "1.0.0+build.01", "1.0.0-a-b.c+d-e", "10.20.30-x.7.z.92"] {
            assert!(is_valid(ok), "{ok}");
        }
        for bad in ["1.0", "01.0.0", "1.0.0-01", "1.0.0-", "1.0.0+", "1.0.0-a..b", "1.0.0+a+b", "v1.0.0", "1.0.0-é", ""] {
            assert!(!is_valid(bad), "{bad}");
        }
    }

    #[test]
    fn precedence() {
        let order = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "2.0.0", "10.0.0"];
        for pair in order.windows(2) {
            assert_eq!(compare(pair[0], pair[1]), Some(Ordering::Less), "{pair:?}");
        }
        assert_eq!(compare("1.0.0+a", "1.0.0+b"), Some(Ordering::Equal));
        assert_eq!(compare("1.0.0", "x"), None);
    }
}
