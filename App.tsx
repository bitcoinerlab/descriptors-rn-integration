import { useState } from "react";
import { BIP32, Output, Psbt, networks } from "@bitcoinerlab/descriptors";
import {
  connectors,
  displayAddress,
  getMasterFingerprint,
  getVersion,
  getXpub,
  keyExpression,
  registerPolicy,
  signMessage,
  signers,
  type Session,
  type Store,
} from "@bitcoinerlab/descriptors/bitbox";
import type { ConnectedBitBoxClient } from "@bitcoinerlab/bitbox-react-native";
import {
  Button,
  Keyboard,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  StatusBar,
  Text,
  TextInput,
  View,
} from "react-native";

const BITCOIN_NETWORK = networks.bitcoin;
const P2WPKH_ORIGIN = "/84'/0'/0'";
const P2WPKH_KEY_PATH = "/0/*";
const MULTISIG_ORIGIN = "/48'/0'/0'/2'";
const MULTISIG_KEY_PATH = "/0/*";
const TIMELOCK_ORIGIN = "/48'/0'/0'/2'";
const TIMELOCK_KEY_PATH = "/0/*";
const TIMELOCK_RELATIVE_BLOCKS = 5;
const FAKE_UTXO_VALUE = 100_000n;
const FAKE_SEND_VALUE = 90_000n;
const MULTISIG_POLICY_NAME = "RN integration multisig";
const ORDERED_MULTISIG_POLICY_NAME = "RN integration ordered multi";
const TIMELOCK_POLICY_NAME = "RN integration timelock";
const MESSAGE_TEXT = "BitBox React Native integration message";
const EMPTY_STORE_JSON = "{}";

type LogLine = {
  id: number;
  text: string;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

function summarizeValue(value: string): string {
  if (value.length <= 20) return value;
  return `${value.slice(0, 10)}...${value.slice(-8)} (length=${value.length})`;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseStoreJson(value: string): Store {
  const parsed = JSON.parse(value.trim() || EMPTY_STORE_JSON) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Descriptors store JSON must be an object.");
  }
  return parsed as Store;
}

function littleEndianHex(value: bigint | number, byteLength: number): string {
  let remaining = BigInt(value);
  if (remaining < 0n) throw new Error(`Negative integer: ${value}`);

  const bytes: string[] = [];
  for (let i = 0; i < byteLength; i++) {
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

function fakeFundingTxHex({
  scriptPubKey,
  value,
}: {
  scriptPubKey: Uint8Array;
  value: bigint;
}): string {
  return [
    "02000000",
    "01",
    "00".repeat(32),
    "ffffffff",
    "00",
    "ffffffff",
    "01",
    littleEndianHex(value, 8),
    varIntHex(scriptPubKey.length),
    bytesToHex(scriptPubKey),
    "00000000",
  ].join("");
}

function accountXpubFromSeed(seedByte: number, originPath: string): string {
  const seed = new Uint8Array(32).fill(seedByte);
  const relativePath = originPath.startsWith("/")
    ? originPath.slice(1)
    : originPath;
  return BIP32.fromSeed(seed, BITCOIN_NETWORK)
    .derivePath(relativePath)
    .neutered()
    .toBase58();
}

function otherMultisigKeys(): string[] {
  return [2, 3].map(
    (seedByte) =>
      `${accountXpubFromSeed(seedByte, MULTISIG_ORIGIN)}${MULTISIG_KEY_PATH}`,
  );
}

async function p2wpkhDescriptor(session: Session): Promise<string> {
  const bitboxKey = await keyExpression({
    session,
    originPath: P2WPKH_ORIGIN,
    keyPath: P2WPKH_KEY_PATH,
  });
  return `wpkh(${bitboxKey})`;
}

async function multisigDescriptor(session: Session): Promise<string> {
  const bitboxKey = await keyExpression({
    session,
    originPath: MULTISIG_ORIGIN,
    keyPath: MULTISIG_KEY_PATH,
  });
  return `wsh(sortedmulti(1,${[bitboxKey, ...otherMultisigKeys()].join(",")}))`;
}

async function orderedMultisigDescriptor(session: Session): Promise<string> {
  const bitboxKey = await keyExpression({
    session,
    originPath: MULTISIG_ORIGIN,
    keyPath: MULTISIG_KEY_PATH,
  });
  return `wsh(multi(1,${[bitboxKey, otherMultisigKeys()[0]].join(",")}))`;
}

async function timelockDescriptor(session: Session): Promise<string> {
  const bitboxKey = await keyExpression({
    session,
    originPath: TIMELOCK_ORIGIN,
    keyPath: TIMELOCK_KEY_PATH,
  });
  return `wsh(and_v(v:pk(${bitboxKey}),older(${TIMELOCK_RELATIVE_BLOCKS})))`;
}

async function generateFakeP2wpkhPsbt(session: Session): Promise<string> {
  const descriptor = await p2wpkhDescriptor(session);
  return generateFakePsbt({ session, fundingDescriptor: descriptor });
}

async function generateFakePsbt({
  session,
  fundingDescriptor,
}: {
  session: Session;
  fundingDescriptor: string;
}): Promise<string> {
  const destinationDescriptor = await p2wpkhDescriptor(session);
  const fundingOutput = new Output({
    descriptor: fundingDescriptor,
    index: 0,
    network: BITCOIN_NETWORK,
  });
  const destinationOutput = new Output({
    descriptor: destinationDescriptor,
    index: 1,
    network: BITCOIN_NETWORK,
  });
  const psbt = new Psbt({ network: BITCOIN_NETWORK });
  const txHex = fakeFundingTxHex({
    scriptPubKey: fundingOutput.getScriptPubKey(),
    value: FAKE_UTXO_VALUE,
  });

  fundingOutput.updatePsbtAsInput({ psbt, txHex, vout: 0 });
  destinationOutput.updatePsbtAsOutput({ psbt, value: FAKE_SEND_VALUE });
  return psbt.toBase64();
}

export default function App() {
  const [running, setRunning] = useState(false);
  const [psbt, setPsbt] = useState("");
  const [storeJson, setStoreJson] = useState(EMPTY_STORE_JSON);
  const [log, setLog] = useState<LogLine[]>([
    {
      id: 0,
      text: "Ready. Use a physical iPhone and a BitBox Nova with Bluetooth enabled.",
    },
  ]);

  function resetLog() {
    setLog([]);
  }

  function resetStore() {
    setStoreJson(EMPTY_STORE_JSON);
    add("Reset descriptors store JSON to {}.");
  }

  function add(text: string) {
    console.log(`[BitBoxIntegration] ${text}`);
    setLog((lines) => [...lines, { id: Date.now() + lines.length, text }]);
  }

  function shareLog() {
    const message = log.map((line) => line.text).join("\n");
    void Share.share({
      title: "BitBox integration test logs",
      message:
        message.length > 0 ? message : "No BitBox integration test logs yet.",
    });
  }

  function runReadOnlyTest() {
    void runWithSession(
      "Running read-only descriptors integration test...",
      async (session) => {
        await readBasics(session);

        add("Building p2wpkh descriptor through keyExpression...");
        const descriptor = await p2wpkhDescriptor(session);
        add(`Descriptor OK: ${summarizeValue(descriptor)}`);

        add("Deriving receive address locally through Output...");
        const address = new Output({
          descriptor,
          index: 0,
          network: BITCOIN_NETWORK,
        }).getAddress();
        add(`Descriptor address OK: ${summarizeValue(address)}`);
      },
    );
  }

  function runDisplayAddressTest() {
    void runWithSession(
      "Running descriptor display-address integration test...",
      async (session) => {
        add("Building p2wpkh descriptor through keyExpression...");
        const descriptor = await p2wpkhDescriptor(session);

        add("Requesting descriptor receive address on device display...");
        const address = await displayAddress({
          descriptor,
          session,
          index: 0,
        });
        add(
          typeof address === "string"
            ? `Displayed BTC address OK: ${summarizeValue(address)}`
            : "Displayed BTC address OK.",
        );
      },
    );
  }

  function runRegistrationTest() {
    void runWithSession(
      "Running descriptors multisig registration integration test...",
      async (session) => {
        add("Building 1-of-3 multisig descriptor through keyExpression...");
        const descriptor = await multisigDescriptor(session);
        add(`Multisig descriptor OK: ${summarizeValue(descriptor)}`);

        add("Registering multisig policy. Confirm on the BitBox if prompted.");
        await registerPolicy({
          descriptor,
          session,
          name: MULTISIG_POLICY_NAME,
        });
        add("registerPolicy multisig OK.");

        add("Displaying registered multisig receive address on the BitBox...");
        const address = await displayAddress({
          descriptor,
          session,
          index: 0,
        });
        add(
          typeof address === "string"
            ? `Multisig address OK: ${summarizeValue(address)}`
            : "Multisig display call OK.",
        );
      },
    );
  }

  function runOrderedMultisigRegistrationTest() {
    void runWithSession(
      "Running descriptors ordered wsh(multi(...)) registration test...",
      async (session) => {
        add("Building 1-of-2 ordered multisig descriptor through keyExpression...");
        const descriptor = await orderedMultisigDescriptor(session);
        add(`Ordered multi descriptor OK: ${summarizeValue(descriptor)}`);

        add(
          "Registering ordered multi policy. Confirm on the BitBox if prompted.",
        );
        await registerPolicy({
          descriptor,
          session,
          name: ORDERED_MULTISIG_POLICY_NAME,
        });
        add("registerPolicy ordered multi OK.");

        add("Displaying registered ordered multi receive address on the BitBox...");
        const address = await displayAddress({
          descriptor,
          session,
          index: 0,
        });
        add(
          typeof address === "string"
            ? `Ordered multi address OK: ${summarizeValue(address)}`
            : "Ordered multi display call OK.",
        );

        add("Generating fake ordered multi PSBT...");
        const orderedMultiPsbt = await generateFakePsbt({
          session,
          fundingDescriptor: descriptor,
        });
        add(`Ordered multi fake PSBT OK: ${summarizeValue(orderedMultiPsbt)}`);

        add("Signing ordered multi fake PSBT. Confirm on the BitBox if prompted.");
        const signedPsbt = await signers.sign({
          psbt: Psbt.fromBase64(orderedMultiPsbt, { network: BITCOIN_NETWORK }),
          session,
        });
        setPsbt(signedPsbt);
        add(`Ordered multi signed PSBT OK: ${summarizeValue(signedPsbt)}`);
      },
    );
  }

  function runTimelockPolicyRegistrationTest() {
    void runWithSession(
      "Running descriptors single-key timelock policy registration test...",
      async (session) => {
        add("Building single-key relative-timelock descriptor...");
        const descriptor = await timelockDescriptor(session);
        add(`Timelock descriptor OK: ${summarizeValue(descriptor)}`);

        add("Registering timelock policy. Confirm on the BitBox if prompted.");
        await registerPolicy({
          descriptor,
          session,
          name: TIMELOCK_POLICY_NAME,
        });
        add("registerPolicy timelock OK.");

        add("Displaying registered timelock receive address on the BitBox...");
        const address = await displayAddress({
          descriptor,
          session,
          index: 0,
        });
        add(
          typeof address === "string"
            ? `Timelock address OK: ${summarizeValue(address)}`
            : "Timelock display call OK.",
        );
      },
    );
  }

  function runPsbtSignTest() {
    const trimmedPsbt = psbt.trim();
    if (!trimmedPsbt) {
      resetLog();
      add("Paste a base64 PSBT before running the PSBT signing integration test.");
      return;
    }
    void runWithSession(
      "Running descriptors PSBT signing integration test...",
      async (session) => {
        add("Parsing pasted bitcoinjs PSBT...");
        const parsedPsbt = Psbt.fromBase64(trimmedPsbt, {
          network: BITCOIN_NETWORK,
        });

        add("Signing PSBT through signers.sign({ psbt, session })...");
        const signedPsbt = await signers.sign({ psbt: parsedPsbt, session });
        setPsbt(signedPsbt);
        add(`Signed PSBT OK: ${summarizeValue(signedPsbt)}`);
      },
    );
  }

  function runGenerateFakePsbtTest() {
    void runWithSession(
      "Generating fake descriptor p2wpkh PSBT...",
      async (session) => {
        add("Deriving fake PSBT through Output.updatePsbtAsInput...");
        const generatedPsbt = await generateFakeP2wpkhPsbt(session);
        setPsbt(generatedPsbt);
        add(`Fake PSBT generated: ${summarizeValue(generatedPsbt)}`);
        add("Now press Sign Pasted PSBT to test descriptors signers.sign.");
      },
    );
  }

  function runMessageSignTest() {
    void runWithSession(
      "Running descriptors message-signing integration test...",
      async (session) => {
        add("Building p2wpkh descriptor through keyExpression...");
        const descriptor = await p2wpkhDescriptor(session);

        add("Signing descriptor message. Confirm on the BitBox.");
        const signature = await signMessage({
          descriptor,
          session,
          message: MESSAGE_TEXT,
          index: 0,
        });
        add(`Message signature OK: ${summarizeValue(bytesToHex(signature))}`);
      },
    );
  }

  async function runWithSession(
    title: string,
    run: (session: Session, client: ConnectedBitBoxClient) => Promise<void>,
  ) {
    if (running) return;
    setRunning(true);
    resetLog();
    let client: ConnectedBitBoxClient | undefined;
    let session: Session | undefined;
    try {
      add(title);
      add(`Platform: ${Platform.OS}`);
      add("Parsing descriptors store JSON...");
      const store = parseStoreJson(storeJson);
      add("Loading @bitcoinerlab/bitbox-react-native...");
      const { connectBitBoxNovaBle } =
        await import("@bitcoinerlab/bitbox-react-native");

      add("Connecting to BitBox Nova over BLE...");
      client = await connectBitBoxNovaBle({ timeoutMs: 60_000 });

      add(`Session: ${JSON.stringify(client.session, null, 2)}`);
      add("Creating descriptors BitBox session from provider client...");
      session = connectors.fromClient({
        client,
        network: BITCOIN_NETWORK,
        store,
      });
      await run(session, client);
    } catch (error) {
      add(`ERROR: ${errorMessage(error)}`);
    } finally {
      if (session) {
        const nextStoreJson = JSON.stringify(session.store, null, 2);
        setStoreJson(nextStoreJson);
        add("Persisted descriptors store JSON from session.store.");
      }
      if (client) {
        try {
          await client.close();
          add("Closed session.");
        } catch (error) {
          add(`Close error: ${errorMessage(error)}`);
        }
      }
      setRunning(false);
    }
  }

  async function readBasics(session: Session) {
    add("Reading firmware version through descriptors...");
    const version = await getVersion({ session });
    add(`Version: ${version}`);

    add("Reading root fingerprint through descriptors...");
    const rootFingerprint = await getMasterFingerprint({ session });
    add(`Root fingerprint: ${bytesToHex(rootFingerprint)}`);

    add("Reading BTC account xpub through descriptors...");
    const xpub = await getXpub({ session, originPath: P2WPKH_ORIGIN });
    add(`BTC xpub OK: ${summarizeValue(xpub)}`);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable style={styles.content} onPress={Keyboard.dismiss}>
          <Text style={styles.eyebrow}>BitBox React Native Integration</Text>
          <Text style={styles.title}>BitBox Nova BLE</Text>
          <Text style={styles.description}>
            This tests BLE connect plus descriptors BitBox helpers. Read-only tests
            do not prompt on the device. Display, registration, message signing,
            and PSBT signing tests require BitBox confirmation. Full xpubs/PSBTs
            are not printed.
          </Text>
          <Text style={styles.sectionLabel}>Descriptors Store JSON</Text>
          <TextInput
            style={styles.storeInput}
            value={storeJson}
            onChangeText={setStoreJson}
            placeholder="{}"
            placeholderTextColor="#667085"
            autoCapitalize="none"
            autoCorrect={false}
            multiline
          />
          <View style={styles.buttonRow}>
            <Button
              title={running ? "Running..." : "Read-Only Test"}
              onPress={runReadOnlyTest}
              disabled={running}
            />
            <Button
              title="Display Address"
              onPress={runDisplayAddressTest}
              disabled={running}
            />
            <Button
              title="Register Multisig"
              onPress={runRegistrationTest}
              disabled={running}
            />
            <Button
              title="Register Ordered Multi"
              onPress={runOrderedMultisigRegistrationTest}
              disabled={running}
            />
            <Button
              title="Register Timelock"
              onPress={runTimelockPolicyRegistrationTest}
              disabled={running}
            />
            <Button
              title="Sign Message"
              onPress={runMessageSignTest}
              disabled={running}
            />
            <Button title="Reset Store" onPress={resetStore} disabled={running} />
            <Button title="Share Logs" onPress={shareLog} disabled={running} />
          </View>
          <TextInput
            style={styles.psbtInput}
            value={psbt}
            onChangeText={setPsbt}
            placeholder="Optional: paste base64 PSBT for signing integration test"
            placeholderTextColor="#667085"
            autoCapitalize="none"
            autoCorrect={false}
            multiline
          />
          <View style={styles.buttonRow}>
            <Button
              title="Generate Fake PSBT"
              onPress={runGenerateFakePsbtTest}
              disabled={running}
            />
            <Button
              title="Sign Pasted PSBT"
              onPress={runPsbtSignTest}
              disabled={running}
            />
          </View>
          <ScrollView
            style={styles.log}
            contentContainerStyle={styles.logContent}
          >
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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#101828",
  },
  screen: {
    flex: 1,
  },
  container: {
    padding: 20,
    paddingBottom: 32,
  },
  content: {
    gap: 12,
  },
  eyebrow: {
    color: "#98a2b3",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  title: {
    color: "#f9fafb",
    fontSize: 34,
    fontWeight: "800",
  },
  description: {
    color: "#d0d5dd",
    fontSize: 16,
    lineHeight: 23,
  },
  buttonRow: {
    marginVertical: 8,
    alignItems: "flex-start",
    gap: 8,
  },
  sectionLabel: {
    color: "#98a2b3",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  storeInput: {
    minHeight: 70,
    maxHeight: 120,
    borderRadius: 12,
    backgroundColor: "#111827",
    color: "#f9fafb",
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 12,
    lineHeight: 17,
    padding: 12,
  },
  psbtInput: {
    minHeight: 70,
    maxHeight: 120,
    borderRadius: 12,
    backgroundColor: "#111827",
    color: "#f9fafb",
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 12,
    lineHeight: 17,
    padding: 12,
  },
  log: {
    minHeight: 240,
    maxHeight: 380,
    borderRadius: 14,
    backgroundColor: "#030712",
  },
  logContent: {
    padding: 14,
    gap: 10,
  },
  logLine: {
    color: "#d1d5db",
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 13,
    lineHeight: 19,
  },
});
