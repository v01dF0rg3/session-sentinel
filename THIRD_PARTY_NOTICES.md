# Third-party notices

## Public Suffix List

`data/public-suffix-rules.js` contains a normalized copy of the Public Suffix List's ICANN
and PRIVATE sections. The list is maintained by the Public Suffix List contributors and
distributed under the [Mozilla Public License 2.0](https://mozilla.org/MPL/2.0/).
Its file-level MPL notice is retained; the project's MIT license does not replace it.

- [Official source](https://publicsuffix.org/list/public_suffix_list.dat)
- [List and usage information](https://publicsuffix.org/list/)
- Source version: `2026-09-03_19-51-30_UTC`
- Upstream commit: `b952f046c27f9b2a7c3e5d2060f9e3acbc4cf1e8`
- Source SHA-256: `aef8fb81d63232dabfe6f3506bc17e8bddf2a98e0ae60768609a1592201e6fec`
- Bundled rules: 10,321

The build-time generator normalizes internationalized domains to ASCII, preserves wildcard
and exception rules, removes comments/duplicates, sorts the rules, and records provenance in
`PSL_METADATA`. The installed extension never downloads the list.

Maintainers can refresh it with `node dev/update-public-suffix.mjs`, or supply a previously
downloaded source file as the first argument. Fetch no more than once daily, review the
generated diff, update this provenance, and run the full tests before shipping. A snapshot
can lag browser/site changes; explicit cookie deletion avoids relying on Chrome's potentially
different suffix snapshot to expand a browsing-data cookie wipe.
