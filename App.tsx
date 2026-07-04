import { useState } from "react";
import {
  Button,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  StatusBar,
  Text,
  View,
} from "react-native";

type LogLine = {
  id: number;
  text: string;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

export default function App() {
  const [running, setRunning] = useState(false);
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
    setLog((lines) => [...lines, { id: Date.now() + lines.length, text }]);
  }

  function runSmokeTest() {
    if (running) return;
    setRunning(true);
    resetLog();
    void runBitBoxSmokeTest();
  }

  async function runBitBoxSmokeTest() {
    let client:
      | Awaited<
          ReturnType<
            (typeof import("@bitcoinerlab/bitbox-react-native"))["connectBitBoxNovaBle"]
          >
        >
      | undefined;
    try {
      add(`Platform: ${Platform.OS}`);
      add("Loading @bitcoinerlab/bitbox-react-native...");
      const { connectBitBoxNovaBle } =
        await import("@bitcoinerlab/bitbox-react-native");

      add("Connecting to BitBox Nova over BLE...");
      client = await connectBitBoxNovaBle({ timeoutMs: 60_000 });

      add(`Session: ${JSON.stringify(client.session, null, 2)}`);

      add("Reading firmware version...");
      const version = await client.version();
      add(`Version: ${version}`);

      add("Reading root fingerprint...");
      const rootFingerprint = await client.rootFingerprint();
      add(`Root fingerprint: ${rootFingerprint}`);
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

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>
        <Text style={styles.eyebrow}>BitBox React Native Smoke Test</Text>
        <Text style={styles.title}>BitBox Nova BLE</Text>
        <Text style={styles.description}>
          This tests only connect, version, and rootFingerprint. BTC xpub,
          address, registration, and signing methods are not wired in Swift yet.
        </Text>
        <View style={styles.buttonRow}>
          <Button
            title={running ? "Running..." : "Run BLE Smoke Test"}
            onPress={runSmokeTest}
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
      </View>
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
