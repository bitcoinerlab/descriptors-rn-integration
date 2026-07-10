# Descriptors RN Integration

Compact Expo development-client harness for React Native hardware-wallet support
provided by `@bitcoinerlab/descriptors`. The app runs one descriptor workflow
through small BitBox and Ledger branches rather than maintaining separate
device-specific test panels.

## Shared Workflow

Every hardware-wallet action uses the selected provider, transport, and
descriptor scenario. The complete workflow:

1. Connects one hardware wallet.
2. Reads the device/app version and a live master fingerprint.
3. Builds the selected key expression and descriptor.
4. Registers or checks a non-standard policy when required.
5. Derives an address locally and displays it on the device.
6. Generates the same fake, no-funds PSBT.
7. Signs the PSBT for every current scenario.
8. Signs a message for standard `wpkh` scenarios.
9. Copies `session.store` into that provider's in-memory JSON field and closes
   the owned session.

BitBox and Ledger stores are separate because their policy metadata is not
interchangeable. The harness does not persist them across app restarts. Each
descriptors `connect(...)` call binds the live fingerprint before returning and
closes the new connection if it does not match the selected store.

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

| Provider | Transport | iOS app path | Android app path | Injected runtime package(s) |
| --- | --- | --- | --- | --- |
| BitBox | Nova BLE | Exposed | Exposed | `@bitcoinerlab/bitbox-react-native` via `driver.module`, with `mode: "ble"` |
| BitBox | USB | Hidden | Exposed | `@bitcoinerlab/bitbox-react-native` via `driver.module`, with `mode: "usb"` |
| Ledger | BLE | Exposed | Exposed | `@ledgerhq/react-native-hw-transport-ble` via `driver.transport`, plus `@ledgerhq/ledger-bitcoin` |
| Ledger | HID/USB | Hidden | Exposed | `@ledgerhq/react-native-hid` via `driver.transport`, plus `@ledgerhq/ledger-bitcoin` |

`Exposed` and `Hidden` describe this harness's transport selector, not upstream
platform support or completed physical validation. In the app, a provider is the
selected wallet family. `@bitcoinerlab/descriptors/bitbox` and
`@bitcoinerlab/descriptors/ledger` are descriptors device entrypoints, while the
packages in the last column are runtime implementations passed into their direct
`connect(...)` APIs.

The earlier BitBox-focused app was physically exercised with BitBox Nova BLE on
iOS. Current `@bitcoinerlab/bitbox-react-native` documentation records physical
Android BLE and USB validation, although this generalized harness has not yet
rerun that matrix. Ledger support in this harness is not labeled real-device
validated until the manual matrix below is completed.

## Injected Drivers

The `driver` property is dependency injection, not the removed public
`connectors` namespace. Literal imports keep every selected native dependency
visible to Metro:

```ts
bitbox.connect({
  driver: {
    module: import("@bitcoinerlab/bitbox-react-native"),
    mode: "ble"
  },
  network,
  store: bitboxStore
});

ledger.connect({
  driver: {
    transport: import("@ledgerhq/react-native-hw-transport-ble"),
    bitcoinApi: import("@ledgerhq/ledger-bitcoin"),
    app: { name: "Bitcoin", minVersion: "2.1.0" }
  },
  network,
  store: ledgerStore
});
```

For BitBox, `@bitcoinerlab/bitbox-react-native` is the injected provider module.
Descriptors calls its BLE or USB connection function according to `driver.mode`
and owns the returned client. For Ledger, descriptors receives a transport module
and the vendor Bitcoin API separately; it opens the transport and constructs the
`AppClient`. The application does neither itself.

Normal connections omit `driver.device` and timeouts. Ledger therefore calls the
transport's `create()` behavior. BitBox calls the selected provider function
without a device id. Both paths select the first matching device according to the
injected package. Every Ledger connection also requires the unlocked device to
have the mainnet `Bitcoin` app open at version `2.1.0` or newer. Returned sessions
own their client or transport and are closed with `session.close()`.

## Dependencies And Expo

Use Node.js 20.19.4 or newer.

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
(cd ../bitbox-react-native && npm run build:src && npm pack)
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

Verify the installed declarations contain Ledger `driver.transport` and
`driver.bitcoinApi`, BitBox `driver.module`, and owned `session.close()`. Also
verify `package-lock.json` has all three refreshed tarball integrities. A bumped
package version or filename is safer than same-version replacement because npm
otherwise reports stale packages as up to date.

`npm pack` does not run `prepublishOnly`, so these explicit builds are required
for local integration artifacts. Before publishing the libraries, use their full
release lifecycle from clean generated output so removed files and stale package
documentation cannot enter the release tarballs.

This repository uses npm and tracks `package-lock.json`. Do not add a Yarn
lockfile.

## Build Checks

Install and run the static checks:

```sh
npm install
npm run typecheck
npm run test:bundle:ios
npm run test:bundle:android
```

`expo export` proves Metro can resolve the literal driver imports and construct
each JavaScript dependency graph. It does not prove autolinking, native-module
availability, Bluetooth/USB communication, or hardware behavior.

After dependency or config-plugin changes, regenerate and inspect both native
projects:

```sh
npx expo prebuild --clean
```

For the physical-device matrix, rebuild and launch development clients on the
selected devices:

```sh
npx expo run:ios --device
npx expo run:android --device
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
