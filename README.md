# Descriptors React Native Integration

Expo development-client app for testing the React Native hardware-wallet APIs in
`@bitcoinerlab/descriptors` on physical iOS and Android devices.

The app runs the same descriptor, address, policy, PSBT, and message-signing
workflows against BitBox and Ledger. It is an integration harness, not a wallet:
it does not hold funds or broadcast transactions. Descriptor stores, PSBTs, and
logs remain in memory; native modules may retain their own pairing state.

## What The App Tests

For the selected wallet, transport, and descriptor scenario, the app can:

- Connect and read the device or Bitcoin app version.
- Read the live master fingerprint.
- Derive an xpub-backed descriptor key expression.
- Build standard, multisig, and Miniscript descriptors.
- Register or check hardware-wallet policies.
- Derive an address locally and confirm it on the device.
- Generate and sign a fake PSBT backed by a synthetic, no-funds transaction.
- Sign a three-input mixed-ownership PSBT without touching its foreign input.
- Sign legacy Bitcoin messages for standard `wpkh` scenarios.
- Close the owned hardware connection after every connected action.

The selectable descriptor scenarios are:

- Ranged `wpkh(KEY/0/*)`.
- Fixed `wpkh(KEY/0/7)`.
- Native `wsh(sortedmulti(...))`.
- Ordered `wsh(multi(...))`.
- Relative-timelock `wsh(and_v(v:pk(...),older(5)))`.

The app uses Bitcoin mainnet derivation paths and `networks.bitcoin`. The fake
PSBT contains no real UTXO and is not intended for broadcast.

## Supported Device Paths

On iOS, the app exposes:

- BitBox Nova over BLE.
- Ledger over BLE.

On Android, the app exposes:

- BitBox Nova over BLE or USB.
- Ledger over BLE or USB/HID.

These are the paths available in the app. Current physical status:

| Path | Status |
| --- | --- |
| BitBox Nova BLE on iOS | Native build passed; physical device not online |
| BitBox Nova BLE on Android | Native build passed; physical device not online |
| BitBox Nova USB on Android | Native build passed; physical device not online |
| Classic BitBox02 USB on Android | Not tested; hardware unavailable |
| Ledger BLE on iOS | Native build passed; physical device not online |
| Ledger BLE on Android | Native build passed; physical device not online |
| Ledger USB/HID on Android | Native build passed; physical device not online |

Classic BitBox02 USB remains structurally supported through the shared USB
VID/PID and canonical `bitbox02-multi` / `bitbox02-btconly` product detection,
but this repository does not claim physical validation without that hardware.

Expo Go cannot load the required native modules. Use an Expo development client.

## How Connections Work

Descriptors exposes separate BitBox and Ledger entrypoints:

```ts
import * as bitbox from "@bitcoinerlab/descriptors/bitbox";
import * as ledger from "@bitcoinerlab/descriptors/ledger";
import * as bitboxDriverModule from "@bitcoinerlab/bitbox-react-native";
```

These entrypoints provide the descriptor operations for each wallet family. The
`driver` argument tells an entrypoint which runtime modules it should use to open
the hardware. Literal imports let Metro resolve the exact modules used by these
branches.

BitBox receives one module that exposes its React Native BLE and USB connection
functions. `mode` chooses which function to call:

```ts
const session = await bitbox.connect({
  driver: {
    module: bitboxDriverModule,
    mode: "ble",
    ...(selectedDevice ? { device: selectedDevice } : {})
  },
  network: networks.bitcoin,
  store: bitboxStore
});
```

Ledger receives two modules: a transport module for opening the device and the
Ledger Bitcoin API for wallet policies and commands:

```ts
const session = await ledger.connect({
  driver: {
    transport: import("@ledgerhq/react-native-hw-transport-ble"),
    bitcoinApi: import("@ledgerhq/ledger-bitcoin"),
    app: { name: "Bitcoin", minVersion: "2.1.0" }
  },
  network: networks.bitcoin,
  store: ledgerStore
});
```

For Android Ledger USB/HID, the transport is instead:

```ts
import("@ledgerhq/react-native-hid")
```

Ledger omits `driver.device` and uses its transport's `create()` behavior.
BitBox passes the selected discovery record when present; automatic mode omits
it and asks the provider for its first matching device.

Every returned session owns its connection. The app always releases it with:

```ts
await session.close();
```

Both connection paths read the live master fingerprint before returning. If an
existing store belongs to another wallet, connection fails and the new resource
is closed.

## BitBox Discovery And Stores

The BitBox section can scan for Nova BLE devices on either platform and list
attached USB devices on Android. Selection is optional: automatic mode retains
the first-matching-device behavior. Discovery labels use `name` when available
and otherwise show `deviceId`; Android USB ids stay only in component state.

After connection, the app logs the native transport, canonical product, and
firmware version. Nova products use the upstream canonical names
`bitbox02-plus-btconly` and `bitbox02-plus-multi`.

BitBox and Ledger stores are separate JSON objects because their cached policy
metadata is different. The app copies `session.store` back into the selected
wallet's JSON field after each connected action.

Stores are held only in React state and are lost when the app restarts. You can
copy the JSON elsewhere when testing reconnection or fingerprint binding. Never
persist a live session.

## Requirements

- Node.js 20.19.4 or newer.
- npm.
- Xcode and CocoaPods for iOS builds.
- Android Studio and the Android SDK for Android builds.
- A physical BitBox Nova or Ledger device.
- The sibling `descriptors` and `bitbox-react-native` repositories while the
  dependencies remain local tarballs.

Ledger tests require an unlocked device with the mainnet `Bitcoin` app open at
version `2.1.0` or newer.

## Install Local Packages

Build and pack the current sibling sources:

```sh
(cd ../bitbox-react-native && npm test)
(cd ../bitbox-react-native && npm run native:go:test)
(cd ../bitbox-react-native && npm run build:src && npm pack)
(cd ../descriptors && npm test)
(cd ../descriptors && npm run build:src && npm run build:packages && npm pack)
(cd ../descriptors/packages/descriptors && npm pack)
```

Install all three tarballs explicitly. `--force` is needed when a tarball keeps
the same package version but its contents have changed:

```sh
npm install --save --force \
  ../bitbox-react-native/bitcoinerlab-bitbox-react-native-0.1.0.tgz \
  ../descriptors/packages/descriptors/bitcoinerlab-descriptors-3.1.7.tgz \
  ../descriptors/bitcoinerlab-descriptors-core-3.1.7.tgz
```

`npm pack` does not run `prepublishOnly`, so the explicit build commands above
are required before creating local tarballs.

This repository uses npm and tracks `package-lock.json`.

Keep `react-native-ble-plx` at `3.4.0`. Ledger BLE `6.41.0` depends on that exact
version, and both must resolve to one native installation:

```sh
npm ls @ledgerhq/react-native-hw-transport-ble react-native-ble-plx --all
```

## Verify The JavaScript Build

```sh
npm run typecheck
npm run test:bundle:ios
npm run test:bundle:android
```

The Expo export and Metro bundle checks verify that all literal imports resolve
for each platform. They do not test native linking, permissions, Bluetooth, USB,
or hardware communication.

## Build A Development Client

After changing native dependencies or Expo config plugins, regenerate the native
projects:

```sh
npx expo prebuild --clean
```

Build and launch on a physical device:

```sh
npx expo run:ios --device
npx expo run:android --device
```

Tracked native configuration lives in `app.json`. The generated `ios/` and
`android/` directories are ignored and should not be edited manually.

## Using The App

1. Select BitBox or Ledger.
2. Select a transport available on the current platform.
3. For BitBox, optionally discover and select a device; automatic mode remains
   available.
4. Select a descriptor scenario.
5. Leave the provider store as `{}` for a new test, or paste a previous store.
6. Run an individual action or **Run Full Workflow**.
7. Allow any Bluetooth or USB permission prompts from the operating system.
8. Confirm address, policy, and signing prompts on the hardware wallet.
9. Inspect or share the on-screen log.

The individual actions make it easier to isolate failures in connection,
derivation, policy registration, address display, PSBT signing, or message
signing. **Run Full Workflow** exercises the complete scenario through one owned
session.

**Sign Mixed-Ownership PSBT** is available for ranged `wpkh`. It creates three
unique synthetic inputs: a pre-signed foreign software-wallet input and two
hardware-owned inputs at `/0/0` and `/0/1`. One whole-PSBT hardware signing call
must preserve the foreign signature and all metadata, add one signature to each
owned input, keep the PSBT partial, and preserve its input and output counts. It
never updates the normal PSBT field, finalizes, or broadcasts the transaction.

## Physical Validation

For each supported device path, verify:

- Runtime permission handling.
- Connection and cleanup.
- Version and fingerprint reads.
- Key-expression and descriptor construction.
- Address confirmation on the hardware wallet.
- Policy registration for non-standard descriptors.
- Fake PSBT signing.
- Mixed-ownership PSBT signing and foreign-signature preservation.
- Message signing where the scenario supports it.
- Store reuse and fingerprint-mismatch rejection.

Record a path as validated only after every applicable step succeeds on the
physical device. Complete path validation covers all five scenarios; message
signing applies only to the two `wpkh` scenarios.

Stale BitBox policy restoration is covered by descriptors unit tests. Do not
reset or damage a physical device solely to reproduce stale device state.
