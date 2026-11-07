# Dependency security maintenance

## Supported dependency line

This physical-device harness stays on Expo SDK 54, React Native 0.81.5, and a
single `react-native-ble-plx` 3.4.0 installation shared with Ledger. Do not run
`npm audit fix --force`: its proposed Expo/transport changes can break the native
integration and are not a supported upgrade path.

Use `npm ci` to reproduce the reviewed dependency tree, then run:

```sh
npm run test:security
npm run audit:security
npm run typecheck
npm run test:bundle
```

The audit command fails on high or critical findings. A successful exit does
**not** mean there are no lower-severity findings. Native dependency changes
also require a clean Expo prebuild and Android/iOS builds; mocks and bundles do
not validate physical hardware.

## Overrides

These are compatibility-tested security overrides, not SDK upgrades:

- `metro` 0.83.8 is the upstream patch that replaces the vulnerable `image-size`
  dependency. Expo's wrapper pins Metro 0.83.3, so a lockfile refresh alone does
  not reach the fix. Both Expo's and React Native's Metro resolution paths are
  covered by image byte/file-metadata regression tests. Do not override
  `image-size` to v2 directly: Metro's older file-path API is incompatible.
- `@expo/metro-config` uses PostCSS >=8.5.23 instead of its old `~8.4.32` range,
  fixing the source-map file disclosure advisories. Regression tests cover
  source-map traversal and absolute paths without a `from` option.

`shell-quote` is updated within React DevTools' existing semver range; its
newline-after-comment command-injection regression is tested without executing
any shell commands.

## Remaining findings (2026-11-07)

After the security refresh, `npm audit` reports **0 critical, 0 high, 16 moderate,
and 1 low** package findings. Counts include parents affected only through their
dependencies; the remaining underlying advisories are:

| Dependency             | Finding                                                                                                                                        | Why it remains                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `glob` 13.x            | Cancellation can leave a filesystem walk running ([advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)).                              | The published fix is in 14.x, outside Expo 54's declared range.                                                                                        |
| `minimatch` 9.x / 10.x | Pattern amplification can cause denial of service ([advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)).                             | The published fix is in 11.x, outside the callers' declared ranges.                                                                                    |
| Ledger's `uuid` 9.0.1  | Missing buffer bounds check in v3/v5/v6 when a destination buffer is supplied ([advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq)). | The fix is in >=11.1.1. Ledger uses v4 without a destination buffer, not the affected API; do not downgrade the transport to satisfy npm's suggestion. |
| `deepmerge` 4.3.1      | Prototype poisoning of returned objects ([advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)).                                       | No patched release is available on this dependency line. Used by Expo config tooling.                                                                  |

The glob/minimatch issues are in host-side build/config tools, not the wallet
signing pipeline. Keep development servers private and do not process untrusted
project configuration or filesystem patterns. These are tracked exceptions,
not claims that vulnerable packages are harmless; revisit them when upstream
fixes compatible ranges or the Expo/Ledger lines are deliberately upgraded.
