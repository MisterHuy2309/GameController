import React, { useEffect, useState, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  AppState,
  TextInput,
  Keyboard,
  TouchableWithoutFeedback,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ScreenOrientation from "expo-screen-orientation";

export default function App() {
  const [selectedBlock, setSelectedBlock] = useState(null);
  const [squareValues, setSquareValues] = useState({});
  const [ip, setIp] = useState("");
  const [savedIp, setSavedIp] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("Disconnected ❌");
  const [isRunning, setIsRunning] = useState(false);
  const [retryPrompt, setRetryPrompt] = useState(false);

  // --- NEW: control lock state ---
  const [controlsDisabled, setControlsDisabled] = useState(false);

  const ws = useRef(null);
  const reconnectTimeout = useRef(null);

  const MAX_FAKE = 1;
  const MAX_REAL = 4;
  const MAX_R1 = 3;

  useEffect(() => {
    lockLandscape();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") lockLandscape();
    });
    loadIp();

    return () => {
      sub.remove();
      cleanupWebSocket();
    };
  }, []);

  const lockLandscape = async () => {
    await ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.LANDSCAPE
    );
  };

  const numbers = [
    [10, 11, 12],
    [7, 8, 9],
    [4, 5, 6],
    [1, 2, 3],
  ];

  const loadIp = async () => {
    try {
      const stored = await AsyncStorage.getItem("server_ip");
      if (stored) {
        setSavedIp(stored);
        setIp(stored);
      }
    } catch (err) {
      console.log("Load IP error:", err);
    }
  };

  const saveIp = async () => {
    if (controlsDisabled) return; // chặn khi đang khóa
    try {
      await AsyncStorage.setItem("server_ip", ip);
      setSavedIp(ip);
      console.log("Saved IP:", ip);
    } catch (err) {
      console.log("Save IP error:", err);
    }
  };

  const cleanupWebSocket = () => {
    if (ws.current) {
      ws.current.onopen = null;
      ws.current.onmessage = null;
      ws.current.onerror = null;
      ws.current.onclose = null;
      try {
        ws.current.close();
      } catch (e) {}
      ws.current = null;
      setIsConnected(false);
      setConnectionStatus("Disconnected ❌");
    }
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = null;
    }
  };

  const connectServer = () => {
    if (controlsDisabled) return; // chặn khi khóa
    if (isConnected) return;

    cleanupWebSocket();

    const url = `ws://${ip || savedIp}`;
    console.log("Connecting to server IP:", url);

    ws.current = new WebSocket(url);

    ws.current.onopen = () => {
      console.log("✅ Connected to server:", url);
      setIsConnected(true);
      setConnectionStatus("Connected ✅");
    };

    ws.current.onmessage = (event) => {
      console.log("📩 Received from server:", event.data);
    };

    ws.current.onerror = (error) => {
      console.log("❌ WebSocket error:", error?.message || "Unknown");
      setIsConnected(false);
      setConnectionStatus("Error ❌");
    };

    ws.current.onclose = () => {
      console.log("❌ WebSocket disconnected");
      setIsConnected(false);
      setConnectionStatus("Disconnected ❌");
      ws.current = null;
    };
  };

  const countBlocks = () => {
    const values = Object.values(squareValues);
    const fakeCount = values.filter((v) => v === "Fake").length;
    const realCount = values.filter((v) => v === "Real").length;
    const r1Count = values.filter((v) => v === "R1").length;
    return { fakeCount, realCount, r1Count };
  };

  const { fakeCount, realCount, r1Count } = countBlocks();

  const handleSquarePress = (num) => {
    if (controlsDisabled) return; // chặn khi khóa
    if (!selectedBlock) return;

    setSquareValues((prev) => {
      const updated = { ...prev };

      if (prev[num] === selectedBlock) {
        delete updated[num];
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({ action: "remove", num }));
        }
        return updated;
      }

      const values = Object.values(prev);
      const fakeCountLocal = values.filter((v) => v === "Fake").length;
      const realCountLocal = values.filter((v) => v === "Real").length;
      const r1CountLocal = values.filter((v) => v === "R1").length;

      if (selectedBlock === "Fake" && fakeCountLocal >= MAX_FAKE) return prev;
      if (selectedBlock === "Real" && realCountLocal >= MAX_REAL) return prev;
      if (selectedBlock === "R1" && r1CountLocal >= MAX_R1) return prev;

      updated[num] = selectedBlock;
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ action: "set", num, value: selectedBlock }));
      }
      return updated;
    });
  };

  const handleResetAll = () => {
    if (controlsDisabled) return; // chặn khi khóa
    setSquareValues({});
    setIsRunning(false);
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ action: "reset" }));
    }
  };

  const handleStart = () => {
    if (!isRunning) {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ action: "start", squares: squareValues }));
      }
      setIsRunning(true);
      setControlsDisabled(true); // khóa toàn bộ nút khi Start
    } else {
      setRetryPrompt(true);
    }
  };

  // IMPORTANT: khi bấm Yes -> trả về bình thường (mở control), KHÔNG reset các ô
  const confirmRetry = (yes) => {
    setRetryPrompt(false);
    if (yes) {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ action: "retry" }));
      }
      // giữ nguyên squareValues, chỉ mở control lại và đổi trạng thái isRunning
      setControlsDisabled(false);
      setIsRunning(false);
    }
  };

  const renderSquares = () =>
    numbers.map((row, rowIndex) => (
      <View key={rowIndex} style={styles.row}>
        {row.map((num) => (
          <TouchableOpacity
            key={num}
            style={[styles.square, controlsDisabled && styles.disabled]}
            onPress={() => handleSquarePress(num)}
            disabled={controlsDisabled}
          >
            <Text style={styles.squareText}>{num}</Text>
            {squareValues[num] && (
              <View
                style={[
                  styles.block,
                  squareValues[num] === "Fake"
                    ? { backgroundColor: "rgba(255,0,0,0.8)" }
                    : squareValues[num] === "Real"
                    ? { backgroundColor: "rgba(0,200,0,0.8)" }
                    : { backgroundColor: "rgba(255,105,180,0.8)" },
                ]}
              >
                <Text style={styles.blockText}>{squareValues[num]}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>
    ));

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={styles.container}>
        <View style={styles.leftPanel}>
          <TouchableOpacity
            style={[
              styles.choiceBlock,
              selectedBlock === "R1" && { backgroundColor: "#ff9ff3" },
              controlsDisabled && styles.disabled,
            ]}
            onPress={() => !controlsDisabled && setSelectedBlock("R1")}
            disabled={controlsDisabled}
          >
            <Text style={styles.choiceText}>R1</Text>
            <Text style={styles.counterText}>{MAX_R1 - r1Count}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.choiceBlock,
              selectedBlock === "Fake" && { backgroundColor: "#ff7675" },
              controlsDisabled && styles.disabled,
            ]}
            onPress={() => !controlsDisabled && setSelectedBlock("Fake")}
            disabled={controlsDisabled}
          >
            <Text style={styles.choiceText}>Fake</Text>
            <Text style={styles.counterText}>{MAX_FAKE - fakeCount}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.choiceBlock,
              selectedBlock === "Real" && { backgroundColor: "#55efc4" },
              controlsDisabled && styles.disabled,
            ]}
            onPress={() => !controlsDisabled && setSelectedBlock("Real")}
            disabled={controlsDisabled}
          >
            <Text style={styles.choiceText}>Real</Text>
            <Text style={styles.counterText}>{MAX_REAL - realCount}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.terminalBox}>
          <TouchableOpacity
            style={[styles.saveButton, controlsDisabled && styles.disabled]}
            onPress={saveIp}
            disabled={controlsDisabled}
          >
            <Text style={styles.saveText}>Save IP</Text>
          </TouchableOpacity>

          <Text style={styles.terminalTitle}>Server Terminal</Text>

          <TextInput
            style={styles.input}
            placeholder="Enter Server IP"
            placeholderTextColor="#aaa"
            value={ip}
            onChangeText={setIp}
            editable={!controlsDisabled}
          />
          <Text style={styles.savedIp}>
            Saved IP: {savedIp ? savedIp : "None"}
          </Text>

          <Text
            style={{
              color: connectionStatus.includes("Connected") ? "#0f0" : "#f00",
              marginBottom: 10,
              fontWeight: "bold",
            }}
          >
            {connectionStatus}
          </Text>

          <TouchableOpacity
            style={[styles.connectButtonBottom, (isConnected || controlsDisabled) && styles.disabled]}
            onPress={connectServer}
            disabled={isConnected || controlsDisabled}
          >
            <Text style={styles.connectText}>Connect</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.rightPanel}>{renderSquares()}</View>

        <View style={styles.startWrapper}>
          <TouchableOpacity
            style={[
              styles.startButton,
              isRunning && { backgroundColor: "#3498db" },
            ]}
            onPress={handleStart}
          >
            <Text style={styles.startText}>{isRunning ? "RETRY" : "START"}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.resetButton, controlsDisabled && styles.disabled]}
          onPress={handleResetAll}
          disabled={controlsDisabled}
        >
          <Text style={styles.resetText}>Reset</Text>
        </TouchableOpacity>

        {retryPrompt && (
          <View style={styles.retryPrompt}>
            <Text style={{ color: "#fff", fontWeight: "bold", marginBottom: 10 }}>
              Do you want Retry?
            </Text>
            <View style={{ flexDirection: "row", justifyContent: "space-around" }}>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => confirmRetry(true)}
              >
                <Text style={{ color: "#fff", fontWeight: "bold" }}>Yes</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => confirmRetry(false)}
              >
                <Text style={{ color: "#fff", fontWeight: "bold" }}>No</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "#f0f0f0",
  },
  leftPanel: {
    width: 120,
    alignItems: "center",
    marginTop: 20,
  },
  rightPanel: {
    flex: 1,
    justifyContent: "center",
    alignItems: "flex-end",
    paddingRight: 40,
  },
  choiceBlock: {
    width: 80,
    height: 80,
    backgroundColor: "#aaa",
    justifyContent: "center",
    alignItems: "center",
    marginVertical: 4,
    borderRadius: 10,
  },
  choiceText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 18,
  },
  counterText: {
    marginTop: 5,
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold",
  },
  row: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  square: {
    width: 70,
    height: 70,
    margin: 5,
    backgroundColor: "#4a90e2",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 10,
    position: "relative",
  },
  squareText: {
    fontSize: 16,
    color: "#fff",
    fontWeight: "bold",
  },
  block: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 10,
  },
  blockText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 14,
  },
  startWrapper: {
    position: "absolute",
    bottom: 30,
    left: 0,
    right: 0,
    alignItems: "center",
    transform: [{ translateX: -40 }],
  },
  startButton: {
    backgroundColor: "#28a745",
    paddingVertical: 15,
    paddingHorizontal: 60,
    borderRadius: 30,
  },
  startText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
    letterSpacing: 2,
  },
  resetButton: {
    position: "absolute",
    bottom: 30,
    left: 30,
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: "#e67e22",
    justifyContent: "center",
    alignItems: "center",
  },
  resetText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 14,
  },
  terminalBox: {
    width: 250,
    height: 180,
    backgroundColor: "#111",
    marginTop: 50,
    marginHorizontal: 20,
    borderRadius: 10,
    paddingHorizontal: 15,
    paddingTop: 10,
    justifyContent: "flex-start",
  },
  saveButton: {
    position: "absolute",
    top: 10,
    right: 10,
    backgroundColor: "#444",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  saveText: {
    color: "#0f0",
    fontWeight: "bold",
    fontSize: 14,
  },
  terminalTitle: {
    color: "#0f0",
    fontWeight: "bold",
    fontSize: 16,
    marginBottom: 15,
  },
  input: {
    backgroundColor: "#222",
    color: "#fff",
    padding: 8,
    borderRadius: 6,
    marginBottom: 8,
    fontSize: 14,
  },
  savedIp: {
    color: "#0f0",
    fontSize: 14,
    marginBottom: 10,
  },
  connectButtonBottom: {
    backgroundColor: "#28a745",
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
  },
  connectText: {
    color: "#fff",
    fontWeight: "bold",
  },
  retryPrompt: {
    position: "absolute",
    top: "40%",
    left: "30%",
    right: "30%",
    backgroundColor: "#333",
    padding: 20,
    borderRadius: 10,
    alignItems: "center",
  },
  retryButton: {
    backgroundColor: "#3498db",
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginHorizontal: 10,
  },
  disabled: { opacity: 0.35 },
});
