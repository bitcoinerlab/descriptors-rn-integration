# Descriptors RN Integration

Compact Expo development-client harness for React Native hardware-wallet support
provided by `@bitcoinerlab/descriptors`. The app runs one descriptor workflow
through small BitBox and Ledger branches rather than maintaining separate
device-specific test panels.

## Shared Workflow

Every action uses the selected provider, connection, and descriptor
scenario. The complete workflow:

1. Connects one hardware wallet.
2. Reads the device/app version and a live master fingerprint.
3. Builds the selected key expression and descriptor.
4. Registers or checks a non-standard policy when required.
5. Derives an address locally and displays it on the device.
6. Generates the same fake, no-funds PSBT.
7. Signs the PSBT when the scenario declares support.
8. Signs a message for standard `wpkh` scenarios.
9. Persists only that provider's JSON store and closes the transport.

BitBox and Ledger stores are separate because their policy metadata is not
interchangeable. Each descriptors connector binds the live fingerprint before
returning and closes the connection if it does not match the selected store.

Shared scenarios cover:

- Ranged fixed-branch `wpkh(KEY/0/*)`, passing `index` only.
- Fixed `wpkh(KEY/0/7)`, passing neither `change` nor `index`.
- Native `wsh(sortedmulti(...))` policy coverage.
- Generic ordered `wsh(multi(...))` policy coverage.
- Relative-timelock `wsh(and_v(v:pk(...),older(5)))` Miniscript coverage.

Absent descriptor positions are omitted from calls; they are never passed as
explicit `undefined`. Multipath descriptors such as `KEY/**` would require both
`change` and `index`, but are not currently a selectable scenario.

## Provider Matrix

| Provider and transport | iOS | Android | Connector |
| --- | --- | --- | --- |
| BitBox Nova BLE | Supported | Supported | `@bitcoinerlab/bitbox-react-native` |
| BitBox USB | Hidden/unsupported | Supported | `@bitcoinerlab/bitbox-react-native` |
| Ledger BLE | Supported | Supported | injected Ledger BLE driver |
| Ledger HID/USB | Hidden/unsupported | Supported | injected Ledger HID driver |

The earlier BitBox-focused app was physically exercised with BitBox Nova BLE on
iOS. Current `@bitcoinerlab/bitbox-react-native` documentation records physical
Android BLE and USB validation, although this generalized harness has not yet
rerun that matrix. Ledger support in this harness is not labeled real-device
validated until the manual matrix below is completed.

## Injected Drivers

The app gives descriptors a literal import promise for the selected native
driver. It does not open transports or construct Ledger `AppClient` itself:

```ts
ledger.connectors.connect({
  driver: {
    module: import("@ledgerhq/react-native-hw-transport-ble"),
    app: { name: "Bitcoin", minVersion: "2.1.0" }
  },
  network,
  store
});
```

Normal connections omit `driver.device` and transport timeouts. Descriptors uses
the driver's default `create()` behavior, which discovers and opens the first
device. BitBox requires only `driver.mode` because its RN module exposes both BLE
and USB. Returned sessions own their resources and are closed with
`session.close()`.

## Dependencies And Expo

Ledger dependencies are pinned to a compatible set:

- `@ledgerhq/ledger-bitcoin@0.3.1`
- `@ledgerhq/react-native-hid@6.39.5`
- `@ledgerhq/react-native-hw-transport-ble@6.41.0`
- `react-native-ble-plx@3.4.0`

Ledger BLE `6.41.0` has an exact normal dependency on
`react-native-ble-plx@3.4.0`. The app pins that same version so npm deduplicates
to one native copy. Verify with:

```sh
npm ls @ledgerhq/react-native-hw-transport-ble react-native-ble-plx --all
```

`app.json` keeps `expo-dev-client`, loads the BitBox plugin through
`@bitcoinerlab/bitbox-react-native/app.plugin`, and configures the
`react-native-ble-plx` plugin with hardware-wallet-neutral permission wording.
Expo Go cannot load these native modules.

`index.ts` must import `./polyfills` first. Hermes does not provide Node's global
`Buffer`, while descriptors and Ledger dependencies require it during module
startup.

The existing iOS bundle identifier and Android application id remain
`com.bitcoinerlab.bitboxintegration`. This intentionally preserves the installed
app identity and app-private BitBox pairing state while the repository and
display identity become `descriptors-rn-integration`. A future identifier change
would install a different app.

## Local Tarballs

The three `@bitcoinerlab/*` dependencies resolve from sibling tarballs. This app
must not silently test stale generated code merely because a tarball has the same
version.

After BitBox provider changes:

```sh
(cd ../bitbox-react-native && npm pack)
```

After descriptors changes, build and pack in this order:

```sh
(cd ../descriptors && npm run build:src && npm run build:packages && npm pack)
(cd ../descriptors/packages/descriptors && npm pack)
```

Then explicitly refresh the app when filenames retain the same version:

```sh
npm install --save --force \
  ../bitbox-react-native/bitcoinerlab-bitbox-react-native-0.1.0.tgz \
  ../descriptors/packages/descriptors/bitcoinerlab-descriptors-3.1.7.tgz \
  ../descriptors/bitcoinerlab-descriptors-core-3.1.7.tgz
```

Verify the installed declarations contain `driver.module` and owned
`session.close()`. Also verify `package-lock.json` has all three refreshed tarball
integrities. A bumped package version or filename is safer than same-version
replacement because npm otherwise reports stale packages as up to date.

This repository uses npm and tracks `package-lock.json`. Do not add a Yarn
lockfile.

## Build Checks

Install and run the checks:

```sh
npm install
npm run typecheck
npm run test:bundle:ios
npm run test:bundle:android
npx expo prebuild --clean
```

`expo export` proves Metro can resolve the literal driver imports and construct
each JavaScript dependency graph. It does not prove autolinking, native-module
availability, Bluetooth/USB communication, or hardware behavior.

After a clean prebuild, rebuild and launch a development client:

```sh
npx expo run:ios
npx expo run:android
```

## Manual Real-Device Matrix

Run permission handling, transport open, Bitcoin app APDU exchange, version,
fingerprint, key expression, address display, registration, message signing where
supported, fake PSBT signing, and disconnect cleanup for:

- BitBox Nova BLE on iOS.
- BitBox Nova BLE on Android.
- BitBox USB on Android.
- Ledger BLE through descriptors on iOS.
- Ledger BLE through descriptors on Android.
- Ledger HID/USB through descriptors on Android.

Display, registration, PSBT signing, and message signing require confirmation on
the hardware wallet. Do not mark a row validated until these actions have run on
the physical device and cleanup has been observed.

## Generated Native Projects

`ios/` and `android/` are generated and ignored. Do not manually edit them.
Change `app.json`, dependencies, or package config plugins, then run
`npx expo prebuild --clean`. Keep host-specific device ids, IPs, ports, and run
logs under `.local/` or `LOCAL_*.md`; both are ignored.

The parent directory can later be renamed by moving this complete repository,
including `.git`. Renaming is not part of app generation and does not require
reinitializing Git or rewriting history.
