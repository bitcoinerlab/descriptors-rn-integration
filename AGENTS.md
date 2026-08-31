# Repository Guide

## Purpose And Boundaries

- This is a single Expo app for physical-device integration testing, not the
  descriptors or native-provider libraries. Library fixes belong in sibling
  repos and must not be made unless the user explicitly expands the task scope.
- `App.tsx` owns the shared workflow and the small provider branches. Keep it in
  one component; do not add per-device panels or duplicate descriptor/PSBT logic.
- Use Expo SDK 54 APIs pinned by `package.json`; do not assume current Expo docs
  apply. Expo Go cannot load the custom native module.

## Published Dependencies

- Install `@bitcoinerlab/descriptors` and
  `@bitcoinerlab/bitbox-react-native` from the npm registry. Do not replace them
  with sibling paths, local tarballs, or `file:` dependencies unless the user
  explicitly requests testing unreleased source.
- `@bitcoinerlab/descriptors-core` is a transitive dependency of
  `@bitcoinerlab/descriptors`; do not add it directly unless app code imports it.
- After dependency updates, verify `package-lock.json` resolves all
  `@bitcoinerlab/*` packages from `https://registry.npmjs.org/`. Inspect the
  installed declarations for Ledger `driver.transport` and `driver.bitcoinApi`,
  BitBox `driver.module`, owned `session.close()`, and fingerprint binding.
- Use npm and preserve `package-lock.json`; do not add a Yarn lockfile.
- Keep `react-native-ble-plx` exactly `3.4.0`: Ledger BLE `6.41.0` depends on
  that exact version, and multiple native copies are unsafe.

## Runtime Wiring

- Keep `import "./polyfills"` first in `index.ts`. It installs global `Buffer`
  before descriptors or Ledger transports load under Hermes.
- `ios/` and `android/` are generated and gitignored. Put tracked native config
  in `app.json` or package config plugins, then use a clean prebuild.
- Expo SDK 54 cannot resolve the BitBox package root as a plugin; use its exported
  `@bitcoinerlab/bitbox-react-native/app.plugin` subpath, never a direct
  `node_modules` path.
- Keep BitBox and Ledger stores separate. Persist `session.store`, not a session;
  this harness only copies stores into provider-specific in-memory JSON fields.
  Owned connections bind the live fingerprint before returning.
- Pass the static `@bitcoinerlab/bitbox-react-native` namespace to BitBox
  `driver.module` so the same module supports discovery and connection. Pass a
  selected discovery record through `driver.device`, or omit it for first-device
  behavior. Ledger keeps literal `driver.transport` and `driver.bitcoinApi`
  promises and first-device behavior. Do not open transports or construct
  `AppClient` for the normal RN path.
- BitBox BLE discovery uses `discoverBitBoxNovaBleDevices(...)`; Android USB uses
  `listAttachedBitBoxUsbDevices()`. Display discovery `name` when present and
  fall back to `deviceId`; never treat discovery data as connected product
  metadata. Read canonical product and firmware from the connected client.
- Close every owned connection with idempotent `session.close()`.
- Keep the mixed-ownership PSBT action shared and limited to ranged `wpkh`. On
  Ledger it must preserve the foreign input signature and metadata and sign only
  both hardware-owned inputs. BitBox currently returns its provider error for
  the foreign input; surface that error without classifying it as a transport
  failure. Never finalize or broadcast the synthetic transaction.
- Preserve the existing native bundle/application identifiers unless explicitly
  asked to change them; replacing them loses the installed app identity and may
  lose app-private BitBox pairing state.

## Verification

- Run `npm run typecheck`, `npm run test:bundle:ios`, and
  `npm run test:bundle:android`. Exports verify literal driver resolution only,
  not native linking or hardware communication.
- After dependency/plugin changes run `npx expo prebuild --clean`, inspect both
  generated projects, and rebuild development clients. Real integration follows
  the supported paths and physical validation checklist in `README.md`; do not
  record a path as validated until its complete workflow has passed.
- Keep host-specific device IDs, IPs, ports, and workaround logs under `.local/`
  or `LOCAL_*.md`; both are intentionally ignored.
