# BitBox React Native Integration

Real-device integration app for `@bitcoinerlab/bitbox-react-native`.

This app intentionally lives outside the library package. It validates the full
React Native/Expo native path with a physical device instead of adding Expo,
React Native, or descriptors dependencies to the library package itself.

## Scope

- iOS BitBox Nova BLE connection through the package's Expo native module.
- Descriptors BitBox `Session` and app-owned `Store` flow through
  `connectors.fromClient(...)`.
- Current native BitBox client methods: `version`, `rootFingerprint`, `btcXpub`,
  `btcAddress`, `btcRegisterScriptConfig`, `btcIsScriptConfigRegistered`,
  `btcSignPSBT`, and `btcSignMessage`.
- Physical wallet-policy registration checks for 1-of-3 multisig and a single-key
  relative-timelock Miniscript policy.
- Shareable logs for real-device runs.
- Fake local PSBT generation for signing-path validation without using real
  funds.

Android is not expected to work until Android USB/BLE support is implemented in
`@bitcoinerlab/bitbox-react-native`.

## Setup

The app currently depends on local package tarballs for
`@bitcoinerlab/bitbox-react-native`, `@bitcoinerlab/descriptors`, and the
transitive `@bitcoinerlab/descriptors-core` package.

After changes in `bitbox-react-native`, refresh its tarball:

```sh
(cd ../bitbox-react-native && npm pack)
```

After changes in `descriptors`, build and refresh the descriptors tarballs:

```sh
(cd ../descriptors && npm run build:src && npm run build:packages && npm pack)
(cd ../descriptors/packages/descriptors && npm pack)
```

Then reinstall this app:

```sh
npm install
```

If npm keeps an old transitive `@bitcoinerlab/descriptors-core` tarball in
`package-lock.json`, install the local descriptors tarballs explicitly and make
sure the lockfile still resolves descriptors-core from
`file:../descriptors/bitcoinerlab-descriptors-core-3.1.7.tgz`:

```sh
npm install --no-save \
  ../descriptors/packages/descriptors/bitcoinerlab-descriptors-3.1.7.tgz \
  ../descriptors/bitcoinerlab-descriptors-core-3.1.7.tgz
```

After the package is published, replace the local tarball dependency with the
published package version.

## React Native Shims

React Native/Hermes does not provide Node's global `Buffer`. The bitcoinjs
descriptors preset loads `ecpair`, which expects `Buffer` during startup, so
`polyfills.ts` installs `buffer`'s implementation before `App.tsx` imports
`@bitcoinerlab/descriptors`.

## Descriptors Store

The app owns a plain JSON descriptors `Store`. The Store is shown in the UI as
editable JSON, passed into `connectors.fromClient({ client, Output, network,
store })`, and written back from `session.store` after each run. Persist the
Store JSON, not the session.

The `Register Timelock` button registers and displays a single-key
`wsh(and_v(v:pk(...),older(5)))` policy. Use it with `Register Multisig` to tell
whether a BitBox policy-registration failure is generic-policy-wide or specific
to the multisig policy.

## Run On iOS

Use a custom dev client or native build. Expo Go cannot load the package's custom
native module.

```sh
npx expo run:ios --device
npx expo start --dev-client --clear
```

The app is pinned to the Expo SDK in `package.json`. Newer Expo SDKs may work,
but should be upgraded deliberately and validated on device.

## Local Notes

Host-specific notes, device IDs, local IPs, ports, and workaround logs should not
be committed. Put them under `.local/` or in `LOCAL_*.md`; both are ignored.
