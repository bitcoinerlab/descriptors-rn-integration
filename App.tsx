import { useEffect, useRef, useState } from "react";
import {
  BIP32,
  ECPair,
  keyExpressionBIP32,
  Output,
  Psbt,
  networks,
  signers as softwareSigners,
} from "@bitcoinerlab/descriptors";
import * as bitbox from "@bitcoinerlab/descriptors/bitbox";
import * as ledger from "@bitcoinerlab/descriptors/ledger";
import * as bitboxDriverModule from "@bitcoinerlab/bitbox-react-native";
import {
  Alert,
  Button,
  Keyboard,
  PermissionsAndroid,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const BITCOIN_NETWORK = networks.bitcoin;
const EMPTY_STORE_JSON = "{}";
const MESSAGE_TEXT = "Descriptors React Native integration message";
const FAKE_UTXO_VALUE = 100_000n;
const FAKE_SEND_VALUE = 90_000n;
const MIXED_SEND_VALUE = 285_000n;

type ProviderId = "bitbox" | "ledger";
type Transport = "ble" | "usb";
type BitBoxDiscoveryDevice =
  | bitboxDriverModule.BitBoxNovaBleDevice
  | bitboxDriverModule.BitBoxUsbDevice;
type HardwareConnection =
  | {
      provider: "bitbox";
      session: bitbox.Session;
    }
  | {
      provider: "ledger";
      session: ledger.Session;
    };

type Position = { change?: number; index?: number };
type ScenarioId = "ranged" | "fixed" | "sorted" | "ordered" | "timelock";
type Scenario = {
  id: ScenarioId;
  label: string;
  originPath: string;
  keyPath: string;
  position: Position;
  policyName?: string;
  messageSigning: boolean;
};

type LogLine = { id: number; text: string };
type PsbtContext = { provider: ProviderId; scenario: ScenarioId };

const BITBOX_PRODUCTS: readonly bitboxDriverModule.BitBoxProduct[] = [
  "bitbox02-multi",
  "bitbox02-btconly",
  "bitbox02-plus-multi",
  "bitbox02-plus-btconly",
];

const SCENARIOS: readonly Scenario[] = [
  {
    id: "ranged",
    label: "Ranged wpkh /0/*",
    originPath: "/84'/0'/0'",
    keyPath: "/0/*",
    position: { index: 0 },
    messageSigning: true,
  },
  {
    id: "fixed",
    label: "Fixed wpkh /0/7",
    originPath: "/84'/0'/0'",
    keyPath: "/0/7",
    position: {},
    messageSigning: true,
  },
  {
    id: "sorted",
    label: "Sorted multisig",
    originPath: "/48'/0'/0'/2'",
    keyPath: "/0/*",
    position: { index: 0 },
    policyName: "RN integration sorted multi",
    messageSigning: false,
  },
  {
    id: "ordered",
    label: "Ordered multisig",
    originPath: "/48'/0'/0'/2'",
    keyPath: "/0/*",
    position: { index: 0 },
    policyName: "RN integration ordered multi",
    messageSigning: false,
  },
  {
    id: "timelock",
    label: "Miniscript timelock",
    originPath: "/48'/0'/0'/2'",
    keyPath: "/0/*",
    position: { index: 0 },
    policyName: "RN integration timelock",
    messageSigning: false,
  },
];

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

function summarizeValue(value: string): string {
  if (value.length <= 28) return value;
  return `${value.slice(0, 14)}...${value.slice(-10)} (length=${value.length})`;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function providerLabel(provider: ProviderId): string {
  return provider === "bitbox" ? "BitBox" : "Ledger";
}

function assertIntegration(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function requestAndroidBlePermissions(): Promise<void> {
  if (Platform.OS !== "android") return;
  const permissions =
    Number(Platform.Version) >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(permissions);
  if (
    permissions.some(
      (permission) => result[permission] !== PermissionsAndroid.RESULTS.GRANTED,
    )
  ) {
    throw new Error("Bluetooth permission was not granted.");
  }
}

function connectedBitBoxMetadata(
  session: bitbox.Session,
): bitboxDriverModule.BitBoxReactNativeSession {
  const metadata = (session.client as { session?: unknown }).session;
  assertIntegration(
    typeof metadata === "object" && metadata !== null,
    "Connected BitBox client did not expose native session metadata.",
  );
  const value = metadata as Partial<bitboxDriverModule.BitBoxReactNativeSession>;
  assertIntegration(
    typeof value.id === "string" && value.id.length > 0,
    "Connected BitBox session did not include a native session id.",
  );
  assertIntegration(
    value.transport === "ble" || value.transport === "usb",
    "Connected BitBox session returned an invalid transport.",
  );
  assertIntegration(
    BITBOX_PRODUCTS.includes(value.product as bitboxDriverModule.BitBoxProduct),
    `Connected BitBox session returned an invalid product: ${String(value.product)}`,
  );
  assertIntegration(
    typeof value.version === "string" && value.version.length > 0,
    "Connected BitBox session did not include a firmware version.",
  );
  if (value.transport === "ble") {
    assertIntegration(
      value.product === "bitbox02-plus-btconly" ||
        value.product === "bitbox02-plus-multi",
      `BitBox Nova BLE returned a non-Nova canonical product: ${value.product}`,
    );
  }
  return value as bitboxDriverModule.BitBoxReactNativeSession;
}

async function connectHardwareWallet({
  provider,
  transport,
  store,
  selectedBitBoxDevice,
}: {
  provider: ProviderId;
  transport: Transport;
  store: object;
  selectedBitBoxDevice?: BitBoxDiscoveryDevice;
}): Promise<HardwareConnection> {
  if (transport === "ble") await requestAndroidBlePermissions();

  if (provider === "bitbox") {
    return {
      provider: "bitbox",
      session: await bitbox.connect({
        driver: {
          module: bitboxDriverModule,
          mode: transport,
          ...(selectedBitBoxDevice ? { device: selectedBitBoxDevice } : {}),
        },
        network: BITCOIN_NETWORK,
        store: store as bitbox.Store,
      }),
    };
  }

  const session =
    transport === "ble"
      ? await ledger.connect({
          driver: {
            transport: import("@ledgerhq/react-native-hw-transport-ble"),
            bitcoinApi: import("@ledgerhq/ledger-bitcoin"),
            app: { name: "Bitcoin", minVersion: "2.1.0" },
          },
          network: BITCOIN_NETWORK,
          store: store as ledger.Store,
        })
      : await ledger.connect({
          driver: {
            transport: import("@ledgerhq/react-native-hid"),
            bitcoinApi: import("@ledgerhq/ledger-bitcoin"),
            app: { name: "Bitcoin", minVersion: "2.1.0" },
          },
          network: BITCOIN_NETWORK,
          store: store as ledger.Store,
        });
  return {
    provider: "ledger",
    session,
  };
}

function version(connection: HardwareConnection): Promise<string> {
  return connection.provider === "bitbox"
    ? bitbox.getVersion({ session: connection.session })
    : ledger.getVersion({ session: connection.session });
}

function masterFingerprint(connection: HardwareConnection): Promise<Uint8Array> {
  return connection.provider === "bitbox"
    ? bitbox.getMasterFingerprint({ session: connection.session })
    : ledger.getMasterFingerprint({ session: connection.session });
}

function hardwareKeyExpression(
  connection: HardwareConnection,
  params: { originPath: string; keyPath: string },
): Promise<string> {
  return connection.provider === "bitbox"
    ? bitbox.keyExpression({ session: connection.session, ...params })
    : ledger.keyExpression({ session: connection.session, ...params });
}

async function hardwareRegisterPolicy(
  connection: HardwareConnection,
  params: { descriptor: string; name: string },
): Promise<void> {
  if (connection.provider === "bitbox") {
    await bitbox.registerPolicy({ session: connection.session, ...params });
  } else {
    await ledger.registerPolicy({ session: connection.session, ...params });
  }
}

function positionParams(position: Position) {
  return {
    ...(position.change !== undefined ? { change: position.change } : {}),
    ...(position.index !== undefined ? { index: position.index } : {}),
  };
}

function hardwareDisplayAddress(
  connection: HardwareConnection,
  descriptor: string,
  position: Position,
): Promise<string> {
  return connection.provider === "bitbox"
    ? bitbox.displayAddress({
        session: connection.session,
        descriptor,
        ...positionParams(position),
      })
    : ledger.displayAddress({
        session: connection.session,
        descriptor,
        ...positionParams(position),
      });
}

function hardwareSignMessage(
  connection: HardwareConnection,
  descriptor: string,
  position: Position,
): Promise<Uint8Array> {
  const params = {
    descriptor,
    message: MESSAGE_TEXT,
    ...positionParams(position),
  };
  return connection.provider === "bitbox"
    ? bitbox.signMessage({ session: connection.session, ...params })
    : ledger.signMessage({ session: connection.session, ...params });
}

async function hardwareSignPsbt(
  connection: HardwareConnection,
  psbt: Psbt,
): Promise<string> {
  if (connection.provider === "bitbox") {
    await bitbox.signers.sign({ session: connection.session, psbt });
  } else {
    await ledger.signers.sign({ session: connection.session, psbt });
  }
  return psbt.toBase64();
}

function hardwareErrorMessage(error: unknown, transport: Transport): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes("open the bitcoin app")) {
    return "Unlock your Ledger and open the Bitcoin app, then try again.";
  }
  if (normalized.includes("does not match store fingerprint")) {
    return "This store belongs to another wallet. Reset the selected store or reconnect the original device.";
  }
  if (normalized.includes("permission")) {
    return "Allow hardware-wallet access in system settings, then try again.";
  }
  if (normalized.includes("powered off")) {
    return "Turn on Bluetooth, then try again.";
  }
  if (
    normalized.includes("timeout") ||
    normalized.includes("no device") ||
    normalized.includes("disconnected")
  ) {
    return `No device was found over ${transport === "ble" ? "Bluetooth" : "USB"}. Check the connection and unlock the wallet.`;
  }
  if (
    normalized.includes("denied") ||
    normalized.includes("rejected") ||
    normalized.includes("cancelled") ||
    normalized.includes("canceled")
  ) {
    return "The operation was cancelled on the hardware wallet.";
  }
  return message;
}

function parseStoreJson(value: string): object {
  const parsed = JSON.parse(value.trim() || EMPTY_STORE_JSON) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Descriptors store JSON must be an object.");
  }
  return parsed;
}

function littleEndianHex(value: bigint | number, byteLength: number): string {
  let remaining = BigInt(value);
  if (remaining < 0n) throw new Error(`Negative integer: ${value}`);
  const bytes: string[] = [];
  for (let index = 0; index < byteLength; index += 1) {
    bytes.push(Number(remaining & 0xffn).toString(16).padStart(2, "0"));
    remaining >>= 8n;
  }
  if (remaining !== 0n) throw new Error(`Integer too large: ${value}`);
  return bytes.join("");
}

function varIntHex(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid varint: ${value}`);
  }
  if (value < 0xfd) return littleEndianHex(value, 1);
  if (value <= 0xffff) return `fd${littleEndianHex(value, 2)}`;
  if (value <= 0xffffffff) return `fe${littleEndianHex(value, 4)}`;
  return `ff${littleEndianHex(value, 8)}`;
}

function fakeFundingTxHex(scriptPubKey: Uint8Array, fundingTag = 0): string {
  assertIntegration(
    Number.isInteger(fundingTag) && fundingTag >= 0 && fundingTag <= 255,
    `Invalid synthetic funding tag: ${fundingTag}`,
  );
  const previousHashByte = fundingTag.toString(16).padStart(2, "0");
  return [
    "02000000",
    "01",
    previousHashByte.repeat(32),
    "ffffffff",
    "00",
    "ffffffff",
    "01",
    littleEndianHex(FAKE_UTXO_VALUE, 8),
    varIntHex(scriptPubKey.length),
    bytesToHex(scriptPubKey),
    "00000000",
  ].join("");
}

function accountXpubFromSeed(seedByte: number, originPath: string): string {
  return BIP32.fromSeed(new Uint8Array(32).fill(seedByte), BITCOIN_NETWORK)
    .derivePath(originPath.slice(1))
    .neutered()
    .toBase58();
}

function outputForDescriptor(
  descriptor: string,
  position: Position,
): InstanceType<typeof Output> {
  return new Output({
    descriptor,
    network: BITCOIN_NETWORK,
    ...(position.change !== undefined ? { change: position.change } : {}),
    ...(position.index !== undefined ? { index: position.index } : {}),
  });
}

function psbtStructureSnapshot(psbt: Psbt): string {
  const keyValues = (values?: readonly { key: Uint8Array; value: Uint8Array }[]) =>
    values?.map(({ key, value }) => ({ key: bytesToHex(key), value: bytesToHex(value) }));
  const derivations = (
    values?: readonly {
      masterFingerprint: Uint8Array;
      pubkey: Uint8Array;
      path: string;
    }[],
  ) =>
    values?.map(({ masterFingerprint, pubkey, path }) => ({
      masterFingerprint: bytesToHex(masterFingerprint),
      pubkey: bytesToHex(pubkey),
      path,
    }));

  return JSON.stringify({
    version: psbt.version,
    locktime: psbt.locktime,
    globalXpub: psbt.data.globalMap.globalXpub?.map(
      ({ extendedPubkey, masterFingerprint, path }) => ({
        extendedPubkey: bytesToHex(extendedPubkey),
        masterFingerprint: bytesToHex(masterFingerprint),
        path,
      }),
    ),
    globalUnknownKeyVals: keyValues(psbt.data.globalMap.unknownKeyVals),
    txInputs: psbt.txInputs.map(({ hash, index, sequence }) => ({
      hash: bytesToHex(hash),
      index,
      sequence,
    })),
    txOutputs: psbt.txOutputs.map(({ script, value }) => ({
      script: bytesToHex(script),
      value: value.toString(),
    })),
    inputs: psbt.data.inputs.map((input) => ({
      nonWitnessUtxo: input.nonWitnessUtxo
        ? bytesToHex(input.nonWitnessUtxo)
        : undefined,
      witnessUtxo: input.witnessUtxo
        ? {
            script: bytesToHex(input.witnessUtxo.script),
            value: input.witnessUtxo.value.toString(),
          }
        : undefined,
      bip32Derivation: derivations(input.bip32Derivation),
      sighashType: input.sighashType,
      porCommitment: input.porCommitment,
      redeemScript: input.redeemScript ? bytesToHex(input.redeemScript) : undefined,
      witnessScript: input.witnessScript
        ? bytesToHex(input.witnessScript)
        : undefined,
      unknownKeyVals: keyValues(input.unknownKeyVals),
    })),
    outputs: psbt.data.outputs.map((output) => ({
      bip32Derivation: derivations(output.bip32Derivation),
      redeemScript: output.redeemScript
        ? bytesToHex(output.redeemScript)
        : undefined,
      witnessScript: output.witnessScript
        ? bytesToHex(output.witnessScript)
        : undefined,
      unknownKeyVals: keyValues(output.unknownKeyVals),
    })),
  });
}

function buildMixedOwnershipPsbt(
  connection: HardwareConnection,
  hardwareDescriptor: string,
): {
  psbt: Psbt;
  foreignSignature: { pubkey: Uint8Array; signature: Uint8Array };
} {
  const foreignMaster = BIP32.fromSeed(
    new Uint8Array(32).fill(42),
    BITCOIN_NETWORK,
  );
  const connectedFingerprint = connection.session.store.masterFingerprint;
  assertIntegration(
    typeof connectedFingerprint === "string",
    "Connected hardware-wallet store is missing its master fingerprint.",
  );
  const foreignFingerprint = bytesToHex(foreignMaster.fingerprint);
  assertIntegration(
    foreignFingerprint !== connectedFingerprint,
    "Deterministic foreign wallet unexpectedly matches the connected wallet.",
  );
  const foreignKey = keyExpressionBIP32({
    masterNode: foreignMaster,
    originPath: "/84'/0'/1'",
    keyPath: "/0/*",
  });
  const foreignDescriptor = `wpkh(${foreignKey})`;
  assertIntegration(
    !foreignDescriptor.includes(connectedFingerprint),
    "Foreign descriptor contains the connected hardware-wallet fingerprint.",
  );

  const foreignOutput = outputForDescriptor(foreignDescriptor, { index: 0 });
  const hardwareOutput0 = outputForDescriptor(hardwareDescriptor, { index: 0 });
  const hardwareOutput1 = outputForDescriptor(hardwareDescriptor, { index: 1 });
  const destinationOutput = outputForDescriptor(hardwareDescriptor, { index: 2 });
  const psbt = new Psbt({ network: BITCOIN_NETWORK });

  foreignOutput.updatePsbtAsInput({
    psbt,
    txHex: fakeFundingTxHex(foreignOutput.getScriptPubKey(), 1),
    vout: 0,
  });
  hardwareOutput0.updatePsbtAsInput({
    psbt,
    txHex: fakeFundingTxHex(hardwareOutput0.getScriptPubKey(), 2),
    vout: 0,
  });
  hardwareOutput1.updatePsbtAsInput({
    psbt,
    txHex: fakeFundingTxHex(hardwareOutput1.getScriptPubKey(), 3),
    vout: 0,
  });
  destinationOutput.updatePsbtAsOutput({ psbt, value: MIXED_SEND_VALUE });

  softwareSigners.signInputBIP32({ psbt, index: 0, node: foreignMaster });
  const foreignSignatures = psbt.data.inputs[0]?.partialSig;
  assertIntegration(
    foreignSignatures?.length === 1,
    "Software wallet did not add exactly one foreign input signature.",
  );
  return {
    psbt,
    foreignSignature: {
      pubkey: new Uint8Array(foreignSignatures[0].pubkey),
      signature: new Uint8Array(foreignSignatures[0].signature),
    },
  };
}

async function buildDescriptor(
  connection: HardwareConnection,
  scenario: Scenario,
): Promise<string> {
  const deviceKey = await hardwareKeyExpression(connection, {
    originPath: scenario.originPath,
    keyPath: scenario.keyPath,
  });
  if (scenario.id === "ranged" || scenario.id === "fixed") {
    return `wpkh(${deviceKey})`;
  }
  if (scenario.id === "timelock") {
    return `wsh(and_v(v:pk(${deviceKey}),older(5)))`;
  }

  const otherKeys = (scenario.id === "sorted" ? [2, 3] : [2]).map(
    (seedByte) =>
      `${accountXpubFromSeed(seedByte, scenario.originPath)}${scenario.keyPath}`,
  );
  const expression = scenario.id === "sorted" ? "sortedmulti" : "multi";
  return `wsh(${expression}(1,${[deviceKey, ...otherKeys].join(",")}))`;
}

async function buildDestinationDescriptor(
  connection: HardwareConnection,
): Promise<string> {
  const key = await hardwareKeyExpression(connection, {
    originPath: "/84'/0'/0'",
    keyPath: "/0/*",
  });
  return `wpkh(${key})`;
}

async function generateFakePsbt(
  connection: HardwareConnection,
  descriptor: string,
  position: Position,
): Promise<string> {
  const fundingOutput = outputForDescriptor(descriptor, position);
  const destinationDescriptor = await buildDestinationDescriptor(connection);
  const destinationOutput = outputForDescriptor(destinationDescriptor, { index: 1 });
  const psbt = new Psbt({ network: BITCOIN_NETWORK });
  fundingOutput.updatePsbtAsInput({
    psbt,
    txHex: fakeFundingTxHex(fundingOutput.getScriptPubKey()),
    vout: 0,
  });
  destinationOutput.updatePsbtAsOutput({ psbt, value: FAKE_SEND_VALUE });
  return psbt.toBase64();
}

export default function App() {
  const [provider, setProvider] = useState<ProviderId>("bitbox");
  const [transport, setTransport] = useState<Transport>("ble");
  const [scenarioId, setScenarioId] = useState<ScenarioId>("ranged");
  const [bitboxDevices, setBitboxDevices] = useState<BitBoxDiscoveryDevice[]>([]);
  const [selectedBitBoxDevice, setSelectedBitBoxDevice] =
    useState<BitBoxDiscoveryDevice>();
  const [stores, setStores] = useState<Record<ProviderId, string>>({
    bitbox: EMPTY_STORE_JSON,
    ledger: EMPTY_STORE_JSON,
  });
  const [psbt, setPsbt] = useState("");
  const [psbtContext, setPsbtContext] = useState<PsbtContext>();
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogLine[]>([
    { id: 0, text: "Ready. Select one provider, transport, and scenario." },
  ]);
  const operationGenerationRef = useRef(0);
  const activeConnectionRef = useRef<HardwareConnection | undefined>(undefined);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);

  const transports: Transport[] =
    Platform.OS === "android" ? ["ble", "usb"] : Platform.OS === "ios" ? ["ble"] : [];
  const scenario = SCENARIOS.find((item) => item.id === scenarioId) ?? SCENARIOS[0];

  function add(text: string) {
    if (!mountedRef.current) return;
    console.log(`[DescriptorsRNIntegration] ${text}`);
    setLog((lines) => [...lines, { id: Date.now() + lines.length, text }]);
  }

  function resetLog() {
    setLog([]);
  }

  useEffect(
    () => () => {
      mountedRef.current = false;
      operationGenerationRef.current += 1;
      const activeConnection = activeConnectionRef.current;
      activeConnectionRef.current = undefined;
      if (activeConnection) {
        void activeConnection.session.close().catch(() => undefined);
      }
    },
    [],
  );

  function clearPsbt() {
    setPsbt("");
    setPsbtContext(undefined);
  }

  function selectProvider(nextProvider: ProviderId) {
    if (running || nextProvider === provider) return;
    clearPsbt();
    setBitboxDevices([]);
    setSelectedBitBoxDevice(undefined);
    setProvider(nextProvider);
  }

  function selectTransport(nextTransport: Transport) {
    if (running || nextTransport === transport) return;
    clearPsbt();
    setBitboxDevices([]);
    setSelectedBitBoxDevice(undefined);
    setTransport(nextTransport);
  }

  function selectBitBoxDevice(device?: BitBoxDiscoveryDevice) {
    if (running) return;
    clearPsbt();
    setSelectedBitBoxDevice(device);
  }

  async function discoverBitBoxDevices() {
    if (
      busyRef.current ||
      provider !== "bitbox" ||
      !transports.includes(transport)
    ) {
      return;
    }
    busyRef.current = true;
    setRunning(true);
    resetLog();
    clearPsbt();
    setBitboxDevices([]);
    setSelectedBitBoxDevice(undefined);
    try {
      add(`Discovering BitBox devices over ${transport.toUpperCase()}...`);
      if (transport === "ble") await requestAndroidBlePermissions();
      assertIntegration(
        transport === "ble" || Platform.OS === "android",
        "BitBox USB discovery is available only on Android.",
      );
      const devices =
        transport === "ble"
          ? await bitboxDriverModule.discoverBitBoxNovaBleDevices({
              scanDurationMs: 5000,
            })
          : await bitboxDriverModule.listAttachedBitBoxUsbDevices();
      if (!mountedRef.current) return;
      setBitboxDevices(devices);
      add(`Found ${devices.length} BitBox device${devices.length === 1 ? "" : "s"}.`);
      for (const device of devices) {
        add(
          `${device.name ?? device.deviceId}${
            device.transport === "ble" && device.rssi !== undefined
              ? ` (RSSI ${device.rssi})`
              : ""
          }`,
        );
      }
    } catch (error) {
      add(`ERROR: ${errorMessage(error)}`);
      Alert.alert(
        `BitBox ${transport.toUpperCase()} discovery failed`,
        hardwareErrorMessage(error, transport),
      );
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setRunning(false);
    }
  }

  async function runWithConnection(
    title: string,
    action: (connection: HardwareConnection) => Promise<void>,
  ) {
    if (busyRef.current || !transports.includes(transport)) return;
    busyRef.current = true;
    const operationGeneration = ++operationGenerationRef.current;
    setRunning(true);
    resetLog();
    const activeProvider = provider;
    const activeTransport = transport;
    const activeBitBoxDevice =
      activeProvider === "bitbox" &&
      selectedBitBoxDevice?.transport === activeTransport
        ? selectedBitBoxDevice
        : undefined;
    let activeConnection: HardwareConnection | undefined;
    try {
      add(title);
      add(`Platform: ${Platform.OS}; provider: ${providerLabel(activeProvider)}.`);
      add(`Transport: ${activeTransport.toUpperCase()}.`);
      if (activeProvider === "bitbox") {
        add(
          `Device: ${
            activeBitBoxDevice?.name ??
            activeBitBoxDevice?.deviceId ??
            "automatic / first matching"
          }.`,
        );
      }
      const store = parseStoreJson(stores[activeProvider]);
      const openedConnection = await connectHardwareWallet({
        provider: activeProvider,
        transport: activeTransport,
        store,
        selectedBitBoxDevice: activeBitBoxDevice,
      });
      if (
        !mountedRef.current ||
        operationGeneration !== operationGenerationRef.current
      ) {
        await openedConnection.session.close();
        return;
      }
      activeConnection = openedConnection;
      activeConnectionRef.current = openedConnection;
      if (activeConnection.provider === "bitbox") {
        const metadata = connectedBitBoxMetadata(activeConnection.session);
        assertIntegration(
          metadata.transport === activeTransport,
          `Connected BitBox transport ${metadata.transport} does not match ${activeTransport}.`,
        );
        add(
          `BitBox native session: transport=${metadata.transport}; product=${metadata.product}; firmware=${metadata.version}.`,
        );
      }
      add(
        `Connected fingerprint: ${activeConnection.session.store.masterFingerprint}.`,
      );
      await action(activeConnection);
    } catch (error) {
      add(`ERROR: ${errorMessage(error)}`);
      Alert.alert(
        `${providerLabel(activeProvider)} ${activeTransport.toUpperCase()} failed`,
        hardwareErrorMessage(error, activeTransport),
      );
    } finally {
      if (activeConnection) {
        const ownsConnection = activeConnectionRef.current === activeConnection;
        if (ownsConnection) activeConnectionRef.current = undefined;
        const nextStore = activeConnection.session.store;
        if (mountedRef.current) {
          setStores((current) => ({
            ...current,
            [activeProvider]: JSON.stringify(nextStore, null, 2),
          }));
          add(`Updated the in-memory ${activeProvider} store separately.`);
        }
        if (ownsConnection) {
          try {
            await activeConnection.session.close();
            add("Disconnected and released hardware-wallet resources.");
          } catch (error) {
            add(`CLEANUP ERROR: ${errorMessage(error)}`);
          }
        }
      }
      busyRef.current = false;
      if (mountedRef.current) setRunning(false);
    }
  }

  async function readBasicsAndDescriptor(
    hardware: HardwareConnection,
  ): Promise<string> {
    add("Reading device/app version through descriptors...");
    add(`Version: ${await version(hardware)}`);
    add("Reading master fingerprint through descriptors...");
    add(`Fingerprint: ${bytesToHex(await masterFingerprint(hardware))}`);
    add(`Building shared scenario: ${scenario.label}...`);
    const descriptor = await buildDescriptor(hardware, scenario);
    add(`Descriptor: ${summarizeValue(descriptor)}`);
    const address = outputForDescriptor(descriptor, scenario.position).getAddress();
    add(`Read-only local address: ${address}`);
    return descriptor;
  }

  function runReadOnly() {
    void runWithConnection("Running shared read-only workflow...", async (hardware) => {
      await readBasicsAndDescriptor(hardware);
    });
  }

  function runRegisterPolicy() {
    void runWithConnection("Running shared policy registration check...", async (hardware) => {
      const descriptor = await buildDescriptor(hardware, scenario);
      if (!scenario.policyName) {
        add("This is a standard descriptor; device policy registration is not required.");
        return;
      }
      add("Calling descriptors registerPolicy; confirm on the device if requested...");
      await hardwareRegisterPolicy(hardware, {
        descriptor,
        name: scenario.policyName,
      });
      add("Policy registration/check complete; store metadata was updated.");
    });
  }

  function runDisplayAddress() {
    void runWithConnection("Running shared address-display workflow...", async (hardware) => {
      const descriptor = await buildDescriptor(hardware, scenario);
      if (scenario.policyName) {
        add("Ensuring policy registration before address display...");
        await hardwareRegisterPolicy(hardware, {
          descriptor,
          name: scenario.policyName,
        });
      }
      add("Requesting address display; confirm on the hardware wallet...");
      const address = await hardwareDisplayAddress(
        hardware,
        descriptor,
        scenario.position,
      );
      add(`Displayed address: ${address}`);
    });
  }

  function runGeneratePsbt() {
    void runWithConnection("Generating the shared fake PSBT...", async (hardware) => {
      const descriptor = await buildDescriptor(hardware, scenario);
      const generated = await generateFakePsbt(
        hardware,
        descriptor,
        scenario.position,
      );
      setPsbt(generated);
      setPsbtContext({ provider, scenario: scenario.id });
      add(`Fake PSBT: ${summarizeValue(generated)}`);
    });
  }

  function runSignPsbt() {
    const value = psbt.trim();
    if (!value) {
      resetLog();
      add("Generate or paste a base64 PSBT first.");
      return;
    }
    if (
      psbtContext &&
      (psbtContext.provider !== provider || psbtContext.scenario !== scenario.id)
    ) {
      resetLog();
      add("The generated PSBT belongs to a different provider or scenario. Generate it again before signing.");
      return;
    }
    void runWithConnection("Running shared PSBT-signing workflow...", async (hardware) => {
      const descriptor = await buildDescriptor(hardware, scenario);
      if (scenario.policyName) {
        add("Ensuring policy registration before PSBT signing...");
        await hardwareRegisterPolicy(hardware, {
          descriptor,
          name: scenario.policyName,
        });
      }
      const parsed = Psbt.fromBase64(value, { network: BITCOIN_NETWORK });
      const signed = await hardwareSignPsbt(hardware, parsed);
      setPsbt(signed);
      setPsbtContext({ provider, scenario: scenario.id });
      add(`Signed PSBT: ${summarizeValue(signed)}`);
    });
  }

  function runSignMessage() {
    if (!scenario.messageSigning) {
      resetLog();
      add("Message signing is supported only for the shared standard wpkh scenarios; the selected policy was not changed silently.");
      return;
    }
    void runWithConnection("Running shared message-signing workflow...", async (hardware) => {
      const descriptor = await buildDescriptor(hardware, scenario);
      const signature = await hardwareSignMessage(
        hardware,
        descriptor,
        scenario.position,
      );
      add(`Message signature: ${summarizeValue(bytesToHex(signature))}`);
    });
  }

  function runMixedOwnershipPsbt() {
    if (scenario.id !== "ranged") {
      resetLog();
      add("Mixed-ownership signing is available only for the ranged wpkh scenario.");
      return;
    }
    void runWithConnection(
      "Running mixed-ownership PSBT-signing workflow...",
      async (hardware) => {
        const descriptor = await buildDescriptor(hardware, scenario);
        const { psbt: mixedPsbt, foreignSignature } = buildMixedOwnershipPsbt(
          hardware,
          descriptor,
        );
        const inputCountBefore = mixedPsbt.inputCount;
        const outputCountBefore = mixedPsbt.txOutputs.length;
        const structureBefore = psbtStructureSnapshot(mixedPsbt);
        const foreignBefore = mixedPsbt.data.inputs[0]?.partialSig?.length ?? 0;
        add(`Foreign input signatures before hardware signing: ${foreignBefore}.`);
        add(
          `PSBT counts before hardware signing: inputs=${inputCountBefore}; outputs=${outputCountBefore}.`,
        );

        const signedBase64 = await hardwareSignPsbt(hardware, mixedPsbt);
        const signed = Psbt.fromBase64(signedBase64, { network: BITCOIN_NETWORK });
        const foreignAfter = signed.data.inputs[0]?.partialSig ?? [];
        const hardwareInput1 = signed.data.inputs[1]?.partialSig ?? [];
        const hardwareInput2 = signed.data.inputs[2]?.partialSig ?? [];

        assertIntegration(
          foreignAfter.length === 1,
          `Foreign input signature count changed to ${foreignAfter.length}.`,
        );
        assertIntegration(
          bytesToHex(foreignAfter[0].pubkey) === bytesToHex(foreignSignature.pubkey) &&
            bytesToHex(foreignAfter[0].signature) ===
              bytesToHex(foreignSignature.signature),
          "The original foreign software signature changed.",
        );
        assertIntegration(
          hardwareInput1.length === 1 && hardwareInput2.length === 1,
          `Expected one signature on each hardware input; received ${hardwareInput1.length} and ${hardwareInput2.length}.`,
        );
        for (const inputIndex of [1, 2]) {
          const input = signed.data.inputs[inputIndex];
          const signature = input?.partialSig?.[0];
          const ownedDerivation = input?.bip32Derivation?.find(
            ({ masterFingerprint }) =>
              bytesToHex(masterFingerprint) === hardware.session.store.masterFingerprint,
          );
          assertIntegration(
            signature &&
              ownedDerivation &&
              bytesToHex(signature.pubkey) === bytesToHex(ownedDerivation.pubkey),
            `Input ${inputIndex} signature does not match its hardware-wallet derivation.`,
          );
        }
        assertIntegration(
          signed.inputCount === inputCountBefore &&
            signed.txOutputs.length === outputCountBefore,
          "Mixed-ownership signing changed the input or output count.",
        );
        assertIntegration(
          psbtStructureSnapshot(signed) === structureBefore,
          "Mixed-ownership signing changed existing PSBT transaction or metadata fields.",
        );
        for (const inputIndex of [0, 1, 2]) {
          assertIntegration(
            signed.validateSignaturesOfInput(
              inputIndex,
              (pubkey, hash, signature) =>
                ECPair.fromPublicKey(pubkey).verify(hash, signature),
            ),
            `Input ${inputIndex} contains an invalid signature.`,
          );
        }
        assertIntegration(
          signed.data.inputs.every(
            ({ finalScriptSig, finalScriptWitness }) =>
              finalScriptSig === undefined && finalScriptWitness === undefined,
          ),
          "Mixed-ownership PSBT was unexpectedly finalized.",
        );
        Psbt.fromBase64(signed.toBase64(), { network: BITCOIN_NETWORK });

        add(`Foreign input signatures after hardware signing: ${foreignAfter.length}.`);
        add(`Hardware-owned input 1 signatures: ${hardwareInput1.length}.`);
        add(`Hardware-owned input 2 signatures: ${hardwareInput2.length}.`);
        add(
          `PSBT counts after hardware signing: inputs=${signed.inputCount}; outputs=${signed.txOutputs.length}.`,
        );
        add("Mixed-ownership signing passed.");
      },
    );
  }

  function runFullWorkflow() {
    void runWithConnection("Running the complete shared workflow...", async (hardware) => {
      const descriptor = await readBasicsAndDescriptor(hardware);
      if (scenario.policyName) {
        add("Registering/checking the non-standard policy...");
        await hardwareRegisterPolicy(hardware, {
          descriptor,
          name: scenario.policyName,
        });
      } else {
        add("Standard descriptor: registration not required.");
      }
      add("Displaying address on the device...");
      const address = await hardwareDisplayAddress(
        hardware,
        descriptor,
        scenario.position,
      );
      add(`Displayed address: ${address}`);
      const generated = await generateFakePsbt(
        hardware,
        descriptor,
        scenario.position,
      );
      setPsbt(generated);
      setPsbtContext({ provider, scenario: scenario.id });
      add(`Generated shared fake PSBT: ${summarizeValue(generated)}`);
      const parsed = Psbt.fromBase64(generated, { network: BITCOIN_NETWORK });
      const signed = await hardwareSignPsbt(hardware, parsed);
      setPsbt(signed);
      setPsbtContext({ provider, scenario: scenario.id });
      add(`Signed PSBT: ${summarizeValue(signed)}`);
      if (scenario.messageSigning) {
        const signature = await hardwareSignMessage(
          hardware,
          descriptor,
          scenario.position,
        );
        add(`Message signature: ${summarizeValue(bytesToHex(signature))}`);
      } else {
        add("Message signing skipped by the selected scenario capability declaration.");
      }
    });
  }

  function resetStore() {
    setStores((current) => ({ ...current, [provider]: EMPTY_STORE_JSON }));
    add(`Reset only the ${provider} store.`);
  }

  function shareLog() {
    const message = log.map((line) => line.text).join("\n");
    void Share.share({
      title: "Descriptors RN integration results",
      message: message || "No descriptors hardware-wallet results yet.",
    });
  }

  const actionDisabled = running || !transports.includes(transport);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable style={styles.content} onPress={Keyboard.dismiss}>
          <Text style={styles.eyebrow}>Descriptors RN Integration</Text>
          <Text style={styles.title}>One workflow, multiple wallets</Text>
          <Text style={styles.description}>
            Select a provider, connection, optional discovered BitBox device, and
            shared descriptor scenario. Every action releases its connection.
          </Text>

          <Text style={styles.sectionLabel}>Provider</Text>
          <View style={styles.choiceRow}>
            {(["bitbox", "ledger"] as const).map((item) => (
              <Choice
                key={item}
                label={providerLabel(item)}
                selected={provider === item}
                disabled={running}
                onPress={() => selectProvider(item)}
              />
            ))}
          </View>

          <Text style={styles.sectionLabel}>Transport</Text>
          <View style={styles.choiceRow}>
            {transports.map((item) => (
              <Choice
                key={item}
                label={
                  item === "ble"
                    ? "Bluetooth (BLE)"
                    : provider === "ledger"
                      ? "USB (HID)"
                      : "USB"
                }
                selected={transport === item}
                disabled={running}
                onPress={() => selectTransport(item)}
              />
            ))}
          </View>
          {provider === "bitbox" ? (
            <>
              <Button
                title="Discover BitBox Devices"
                onPress={() => void discoverBitBoxDevices()}
                disabled={actionDisabled}
              />
              <View style={styles.choiceColumn}>
                <Choice
                  label="Automatic / first matching device"
                  selected={selectedBitBoxDevice === undefined}
                  disabled={running}
                  onPress={() => selectBitBoxDevice()}
                />
                {bitboxDevices.map((device) => (
                  <Choice
                    key={`${device.transport}:${device.deviceId}`}
                    label={`${device.name ?? device.deviceId}${
                      device.transport === "ble" && device.rssi !== undefined
                        ? ` (RSSI ${device.rssi})`
                        : ""
                    }`}
                    selected={selectedBitBoxDevice?.deviceId === device.deviceId}
                    disabled={running}
                    onPress={() => selectBitBoxDevice(device)}
                  />
                ))}
              </View>
            </>
          ) : null}
          <Text style={styles.sectionLabel}>Shared Scenario</Text>
          <View style={styles.choiceColumn}>
            {SCENARIOS.map((item) => (
              <Choice
                key={item.id}
                label={item.label}
                selected={scenario.id === item.id}
                disabled={running}
                onPress={() => {
                  setScenarioId(item.id);
                  clearPsbt();
                }}
              />
            ))}
          </View>

          <Text style={styles.sectionLabel}>{providerLabel(provider)} Store JSON</Text>
          <TextInput
            style={styles.multiInput}
            value={stores[provider]}
            onChangeText={(value) =>
              setStores((current) => ({ ...current, [provider]: value }))
            }
            placeholder="{}"
            placeholderTextColor="#718096"
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            editable={!running}
          />

          <Text style={styles.sectionLabel}>Workflow Actions</Text>
          <View style={styles.buttonGrid}>
            <Button title="Read + Build" onPress={runReadOnly} disabled={actionDisabled} />
            <Button title="Register / Check" onPress={runRegisterPolicy} disabled={actionDisabled} />
            <Button title="Display Address" onPress={runDisplayAddress} disabled={actionDisabled} />
            <Button title="Generate Fake PSBT" onPress={runGeneratePsbt} disabled={actionDisabled} />
            <Button title="Sign Current PSBT" onPress={runSignPsbt} disabled={actionDisabled} />
            <Button
              title="Sign Mixed-Ownership PSBT"
              onPress={runMixedOwnershipPsbt}
              disabled={actionDisabled || scenario.id !== "ranged"}
            />
            <Button title="Sign Message" onPress={runSignMessage} disabled={actionDisabled} />
            <Button title="Run Full Workflow" onPress={runFullWorkflow} disabled={actionDisabled} />
            <Button title="Reset Selected Store" onPress={resetStore} disabled={actionDisabled} />
            <Button title="Share Results" onPress={shareLog} disabled={running} />
          </View>

          <TextInput
            style={styles.multiInput}
            value={psbt}
            onChangeText={(value) => {
              setPsbt(value);
              setPsbtContext(undefined);
            }}
            placeholder="Generated or pasted base64 PSBT"
            placeholderTextColor="#718096"
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            editable={!running}
          />

          <ScrollView style={styles.log} contentContainerStyle={styles.logContent}>
            {log.map((line) => (
              <Text key={line.id} style={styles.logLine} selectable>
                {line.text}
              </Text>
            ))}
          </ScrollView>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Choice({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      style={[styles.choice, selected && styles.choiceSelected]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#111820" },
  screen: { flex: 1 },
  container: { padding: 20, paddingBottom: 40 },
  content: { gap: 12 },
  eyebrow: {
    color: "#d8a657",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: { color: "#f6f1e7", fontSize: 32, fontWeight: "800", lineHeight: 36 },
  description: { color: "#bdc7c9", fontSize: 15, lineHeight: 22 },
  sectionLabel: {
    color: "#7fa6a1",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.9,
    marginTop: 8,
    textTransform: "uppercase",
  },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choiceColumn: { alignItems: "flex-start", gap: 7 },
  choice: {
    borderColor: "#3b4a4d",
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  choiceSelected: { backgroundColor: "#d8a657", borderColor: "#d8a657" },
  choiceText: { color: "#dce4e3", fontSize: 13, fontWeight: "600" },
  choiceTextSelected: { color: "#182022" },
  buttonGrid: { alignItems: "flex-start", gap: 8 },
  multiInput: {
    minHeight: 84,
    maxHeight: 150,
    backgroundColor: "#182329",
    borderColor: "#33444a",
    borderRadius: 8,
    borderWidth: 1,
    color: "#eef2ed",
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 11,
    lineHeight: 16,
    padding: 11,
  },
  log: { minHeight: 260, maxHeight: 420, backgroundColor: "#080d10", borderRadius: 8 },
  logContent: { gap: 9, padding: 13 },
  logLine: {
    color: "#ccd6d3",
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 12,
    lineHeight: 18,
  },
});
