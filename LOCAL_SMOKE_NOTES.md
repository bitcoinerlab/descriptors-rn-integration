# Local Smoke Notes

These notes document the local iOS smoke-test setup on this machine. They are
for future agents working from this same host, not public package docs.

If this smoke app is ever published, remove this file and any host-specific
workarounds or investigation notes first.

## Scope

- App path: `/Users/landabaso/bitcoinerlab/bitbox-rn-smoke`.
- Library path: `/Users/landabaso/bitcoinerlab/bitbox-react-native`.
- Physical device used: iPhone `00008030-001C258E2EEA402E`.
- Tested hardware path: BitBox Nova over iOS BLE.
- This smoke app is not intended for publication as-is.

## Current Working Baseline

- Expo SDK: `54.0.0` family.
- React Native: `0.81.5`.
- React: `19.1.0`.
- `expo-dev-client`: `~6.0.21`.
- New Architecture is enabled. Do not switch to legacy architecture for this
  package target.
- Metro port used locally: `8082`.
- The app dynamically imports `@bitcoinerlab/bitbox-react-native` only after the
  `Run BLE Smoke Test` button is pressed. This keeps app startup separate from
  BitBox module loading during debugging.

## Host-Specific Build Findings

These are tied to this host's installed Xcode/Swift toolchain at the time of the
test. Re-evaluate after Xcode upgrades.

- Installed Swift was `Apple Swift version 6.1.2`.
- Expo SDK 57 and SDK 56 failed because `expo-modules-jsi/apple/Package.swift`
  required `// swift-tools-version: 6.2`.
- Expo SDK 55 got past Swift package resolution but failed building
  `ExpoModulesCore` with Swift concurrency/MainActor errors under Swift 6.1.2.
- Expo SDK 54 was the first SDK tested here that built and launched on the
  physical iPhone with the available toolchain.
- SDK 55/56/57 should be revisited on this host only after installing an Xcode
  version with a compatible Swift toolchain.

## Local New Architecture Dev Client Fix

The generated SDK 54 `ios/bitboxrnsmoke/AppDelegate.swift` crashed after loading
the dev-client URL with:

```text
ExpoAppDelegate.swift:31: Fatal error: recreateRootView: Missing factory in ExpoAppDelegate
```

The local fix was to bind the factory after creating it:

```swift
reactNativeDelegate = delegate
reactNativeFactory = factory
bindReactNativeFactory(factory)
```

Keep this line in `AppDelegate.swift` when running this smoke app. If
`npx expo prebuild` rewrites the iOS project, verify the line is still present
before testing the QR/dev-client flow.

This is documented here as a smoke-app/generated-template workaround, not as a
library API requirement.

## Package-Level Issues Found During Smoke Testing

Two issues found here were general package issues and were fixed in the library
repo, not just in the smoke app:

- Expo Modules autolinking did not register `BitcoinerlabBitBoxModule` until
  `expo-module.config.json` explicitly declared the root podspec path and Swift
  module name.
- CocoaPods did not make the vendored gomobile `Bitboxnative.xcframework`
  visible to the BitBox pod's Swift sources until the podspec used top-level
  Swift source globs and explicit framework search paths.

After those fixes, `ExpoModulesProvider.swift` should contain:

```swift
import BitcoinerlabBitBoxReactNative
...
BitcoinerlabBitBoxModule.self
```

## Commands

Start Metro and keep it running:

```sh
cd /Users/landabaso/bitcoinerlab/bitbox-rn-smoke
npx expo start --dev-client --host lan --port 8082 --clear
```

Build/reinstall on the physical iPhone:

```sh
cd /Users/landabaso/bitcoinerlab/bitbox-rn-smoke
npx expo run:ios --device 00008030-001C258E2EEA402E --no-bundler
```

Launch with console attached if the app crashes:

```sh
xcrun devicectl device process launch \
  --device 00008030-001C258E2EEA402E \
  --terminate-existing \
  --console \
  --payload-url "exp+bitbox-rn-smoke://expo-development-client/?url=http%3A%2F%2F192.168.1.84%3A8082" \
  com.bitcoinerlab.bitboxsmoke
```

Update the IP in the payload URL if the Mac's LAN IP changes.

## Verification Checklist

- `npx tsc --noEmit` passes in the smoke app.
- `ios/bitboxrnsmoke/Info.plist` has `NSBluetoothAlwaysUsageDescription`.
- `ios/bitboxrnsmoke/Info.plist` has `RCTNewArchEnabled` set to true.
- `ios/Podfile.lock` contains `BitcoinerlabBitBoxReactNative`.
- `ios/Pods/Target Support Files/Pods-bitboxrnsmoke/ExpoModulesProvider.swift`
  imports `BitcoinerlabBitBoxReactNative` and returns
  `BitcoinerlabBitBoxModule.self`.
- `ios/Pods/Target Support Files/BitcoinerlabBitBoxReactNative/*.xcconfig`
  includes search paths for `Bitboxnative.xcframework`.

## Pairing Notes

The BLE pairing UX was rough but the smoke test eventually connected and printed
the root fingerprint. To try pairing from scratch, clear both sides:

- iOS Settings -> Bluetooth -> BitBox Nova -> Forget This Device.
- On the BitBox Nova, remove/forget the iPhone pairing or clear Bluetooth
  pairings if available.
- Delete/reinstall the smoke app if you want to clear dev-client state too.

The current package does not yet implement a polished persisted Noise pairing
store, so first-pair behavior may remain rough until that is designed.
