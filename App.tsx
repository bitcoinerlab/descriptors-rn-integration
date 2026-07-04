import { useState } from "react";
import type {
  BitBoxScriptConfig,
  ConnectedBitBoxClient,
} from "@bitcoinerlab/bitbox-react-native";
import { HDKey } from "@scure/bip32";
import { base64 } from "@scure/base";
import { Transaction, bip32Path, p2wpkh } from "@scure/btc-signer";
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

const P2WPKH_ACCOUNT = "m/84'/0'/0'";
const P2WPKH_RECEIVE = `${P2WPKH_ACCOUNT}/0/0`;
const P2WPKH_CONFIG: BitBoxScriptConfig = { simpleType: "p2wpkh" };

const MULTISIG_ACCOUNT = "m/48'/0'/0'/2'";
const MULTISIG_RECEIVE = `${MULTISIG_ACCOUNT}/0/0`;
const MULTISIG_OTHER_XPUBS = [
  "xpub6Esa6esRHkbuXtbdDKqu3uWjQ1GpK39WW2hxbUAN4L3TxrwDyghEwBtUYZ8uK8LZh3tJ3pjWEpxng9tjfo7RT9BaZKV2T3EPvmZ6N1LgSdj",
  "xpub6FJ6FAAFUzuWQAKyT98Ngs6UwsoPfPCdmepqX2aLLPT54M85ARsWzPciFd49foStMwhWgfiHP6PnMgPrWLrBJpUHgqw8vZPd5ov8uSfW2vo",
];

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

function hexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex)) {
    throw new Error(`Invalid hex string: ${hex}`);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function fingerprintNumber(rootFingerprint: string): number {
  const bytes = hexToBytes(rootFingerprint);
  if (bytes.length !== 4) {
    throw new Error(`Root fingerprint must be 4 bytes: ${rootFingerprint}`);
  }
  return (
    bytes[0] * 0x1000000 +
    bytes[1] * 0x10000 +
    bytes[2] * 0x100 +
    bytes[3]
  );
}

async function generateFakeP2wpkhPsbt(
  client: ConnectedBitBoxClient,
): Promise<string> {
  const rootFingerprint = await client.rootFingerprint();
  const accountXpub = await client.btcXpub(
    "btc",
    P2WPKH_ACCOUNT,
    "xpub",
    false,
  );
  const account = HDKey.fromExtendedKey(accountXpub);
  const child = account.deriveChild(0).deriveChild(0);
  if (!child.publicKey) {
    throw new Error("Could not derive child public key from BitBox xpub");
  }

  const payment = p2wpkh(child.publicKey);
  const previousTx = new Transaction();
  previousTx.addInput({
    txid: "00".repeat(32),
    index: 0xffffffff,
    sequence: 0xffffffff,
  });
  previousTx.addOutput({
    amount: 100_000n,
    script: payment.script,
  });

  const tx = new Transaction();
  tx.addInput({
    txid: previousTx.id,
    index: 0,
    nonWitnessUtxo: previousTx.toBytes(),
    witnessUtxo: {
      amount: 100_000n,
      script: payment.script,
    },
    bip32Derivation: [
      [
        child.publicKey,
        {
          fingerprint: fingerprintNumber(rootFingerprint),
          path: bip32Path(P2WPKH_RECEIVE),
        },
      ],
    ],
  });
  tx.addOutputAddress(payment.address, 90_000n);
  return base64.encode(tx.toPSBT());
}

export default function App() {
  const [running, setRunning] = useState(false);
  const [psbt, setPsbt] = useState("");
  const [log, setLog] = useState<LogLine[]>([
    {
      id: 0,
      text: "Ready. Use a physical iPhone and a BitBox Nova with Bluetooth enabled.",
    },
  ]);

  function resetLog() {
    setLog([]);
  }

  function add(text: string) {
    console.log(`[BitBoxSmoke] ${text}`);
    setLog((lines) => [...lines, { id: Date.now() + lines.length, text }]);
  }

  function shareLog() {
    const message = log.map((line) => line.text).join("\n");
    void Share.share({
      title: "BitBox smoke test logs",
      message: message.length > 0 ? message : "No BitBox smoke test logs yet.",
    });
  }

  function runSmokeTest() {
    void runWithClient("Running read-only smoke test...", async (client) => {
      await readBasics(client);

      add("Reading BTC receive address without device display...");
      const address = await client.btcAddress(
        "btc",
        P2WPKH_RECEIVE,
        P2WPKH_CONFIG,
        false,
      );
      add(`BTC address OK: ${summarizeValue(address)}`);
    });
  }

  function runDisplayAddressTest() {
    void runWithClient(
      "Running device-display address smoke test...",
      async (client) => {
        add("Requesting BTC receive address on device display...");
        const address = await client.btcAddress(
          "btc",
          P2WPKH_RECEIVE,
          P2WPKH_CONFIG,
          true,
        );
        add(`Displayed BTC address OK: ${summarizeValue(address)}`);
      },
    );
  }

  function runRegistrationTest() {
    void runWithClient(
      "Running multisig registration smoke test...",
      async (client) => {
        add("Reading multisig account xpub without device display...");
        const ownXpub = await client.btcXpub(
          "btc",
          MULTISIG_ACCOUNT,
          "xpub",
          false,
        );
        add(`Multisig account xpub OK: ${summarizeValue(ownXpub)}`);

        const multisigConfig: BitBoxScriptConfig = {
          multisig: {
            threshold: 1,
            xpubs: [ownXpub, ...MULTISIG_OTHER_XPUBS],
            ourXpubIndex: 0,
            scriptType: "p2wsh",
          },
        };

        add("Checking multisig registration state...");
        const registeredBefore = await client.btcIsScriptConfigRegistered(
          "btc",
          multisigConfig,
          MULTISIG_ACCOUNT,
        );
        add(`Registered before: ${registeredBefore}`);

        if (!registeredBefore) {
          add("Registering multisig smoke account. Confirm on the BitBox.");
          await client.btcRegisterScriptConfig(
            "btc",
            multisigConfig,
            MULTISIG_ACCOUNT,
            "autoXpubTpub",
            "RN smoke multisig",
          );
          add("Registration call OK.");
        }

        const registeredAfter = await client.btcIsScriptConfigRegistered(
          "btc",
          multisigConfig,
          MULTISIG_ACCOUNT,
        );
        add(`Registered after: ${registeredAfter}`);

        add("Reading multisig receive address without device display...");
        const address = await client.btcAddress(
          "btc",
          MULTISIG_RECEIVE,
          multisigConfig,
          false,
        );
        add(`Multisig address OK: ${summarizeValue(address)}`);
      },
    );
  }

  function runPsbtSignTest() {
    const trimmedPsbt = psbt.trim();
    if (!trimmedPsbt) {
      resetLog();
      add("Paste a base64 PSBT before running the PSBT signing smoke test.");
      return;
    }
    void runWithClient("Running PSBT signing smoke test...", async (client) => {
      add("Signing pasted PSBT with forced p2wpkh m/84'/0'/0' config...");
      const signedPsbt = await client.btcSignPSBT(
        "btc",
        trimmedPsbt,
        { scriptConfig: P2WPKH_CONFIG, keypath: P2WPKH_ACCOUNT },
        "default",
      );
      add(`Signed PSBT OK: ${summarizeValue(signedPsbt)}`);
    });
  }

  function runGenerateFakePsbtTest() {
    void runWithClient("Generating fake p2wpkh PSBT...", async (client) => {
      add("Deriving fake PSBT from BitBox account xpub locally...");
      const generatedPsbt = await generateFakeP2wpkhPsbt(client);
      setPsbt(generatedPsbt);
      add(`Fake PSBT generated: ${summarizeValue(generatedPsbt)}`);
      add("Now press Sign Pasted PSBT to test btcSignPSBT.");
    });
  }

  async function runWithClient(
    title: string,
    run: (client: ConnectedBitBoxClient) => Promise<void>,
  ) {
    if (running) return;
    setRunning(true);
    resetLog();
    let client: ConnectedBitBoxClient | undefined;
    try {
      add(title);
      add(`Platform: ${Platform.OS}`);
      add("Loading @bitcoinerlab/bitbox-react-native...");
      const { connectBitBoxNovaBle } =
        await import("@bitcoinerlab/bitbox-react-native");

      add("Connecting to BitBox Nova over BLE...");
      client = await connectBitBoxNovaBle({ timeoutMs: 60_000 });

      add(`Session: ${JSON.stringify(client.session, null, 2)}`);
      await run(client);
    } catch (error) {
      add(`ERROR: ${errorMessage(error)}`);
    } finally {
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

  async function readBasics(client: ConnectedBitBoxClient) {
    add("Reading firmware version...");
    const version = await client.version();
    add(`Version: ${version}`);

    add("Reading root fingerprint...");
    const rootFingerprint = await client.rootFingerprint();
    add(`Root fingerprint: ${rootFingerprint}`);

    add("Reading native BTC xpub without device display...");
    const xpub = await client.btcXpub("btc", P2WPKH_ACCOUNT, "xpub", false);
    add(`BTC xpub OK: ${summarizeValue(xpub)}`);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <Pressable style={styles.container} onPress={Keyboard.dismiss}>
        <Text style={styles.eyebrow}>BitBox React Native Smoke Test</Text>
        <Text style={styles.title}>BitBox Nova BLE</Text>
        <Text style={styles.description}>
          This tests BLE connect plus the native BTC methods. Read-only tests do
          not prompt on the device. Display, registration, and PSBT signing tests
          require BitBox confirmation. Full xpubs/PSBTs are not printed.
        </Text>
        <View style={styles.buttonRow}>
          <Button
            title={running ? "Running..." : "Read-Only Smoke"}
            onPress={runSmokeTest}
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
          <Button title="Share Logs" onPress={shareLog} disabled={running} />
        </View>
        <TextInput
          style={styles.psbtInput}
          value={psbt}
          onChangeText={setPsbt}
          placeholder="Optional: paste base64 PSBT for signing smoke test"
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#101828",
  },
  container: {
    flex: 1,
    padding: 20,
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
    flex: 1,
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
