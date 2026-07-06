# BitBox React Native Integration

Real-device integration app for `@bitcoinerlab/bitbox-react-native`.

This app intentionally lives outside the library package. It validates the full
React Native/Expo native path with a physical device instead of adding Expo,
React Native, or descriptors dependencies to the library package itself.

## Scope

- iOS BitBox Nova BLE connection through the package's Expo native module.
- Current native BitBox client methods: `version`, `rootFingerprint`, `btcXpub`,
  `btcAddress`, `btcRegisterScriptConfig`, `btcIsScriptConfigRegistered`, and
  `btcSignPSBT`.
- Shareable logs for real-device runs.
- Fake local PSBT generation for signing-path validation without using real
  funds.

Android is not expected to work until Android USB/BLE support is implemented in
`@bitcoinerlab/bitbox-react-native`.

## Setup

The app currently depends on a local package tarball:

```sh
cd ../bitbox-react-native
npm pack

cd ../bitbox-rn-integration
npm install
```

After the package is published, replace the local tarball dependency with the
published package version.

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
