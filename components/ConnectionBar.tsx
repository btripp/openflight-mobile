import { useEffect, useState } from 'react';
import { Keyboard, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSessionStore } from '../stores/useSessionStore';
import { socketService } from '../services/socket';
import { DEFAULT_SERVER_URL, loadServerUrl } from '../storage/connection';
import type { ConnectionState } from '../types';
import { fontFamily } from './theme/fonts';
import { radius, spacing, type Palette } from './theme/tokens';
import { useTheme, useThemedStyles } from './theme/useTheme';

const STATUS_LABEL: Record<ConnectionState, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  connected: 'Connected',
  error: 'Connection failed',
};

// Palette colour for each state's dot. The dot is decorative — the label beside
// it carries the state — so it need not meet text contrast.
const STATUS_COLOR: Record<ConnectionState, keyof Palette> = {
  disconnected: 'textFaint',
  connecting: 'warning',
  connected: 'success',
  error: 'error',
};

// Title bar + connection controls for the Live screen. Owns the server-URL text
// field (UI-only state, seeded from persisted storage); all connection state
// lives in the shared store and is driven by the socket service.
export function ConnectionBar() {
  const connectionState = useSessionStore((s) => s.connectionState);
  const isConnected = connectionState === 'connected';
  // An attempt is outstanding: either still in flight, or failed and being
  // retried by Socket.IO in the background. Both need a way out — otherwise the
  // only escape from a wrong address or an unreachable Pi is force-quitting.
  const isAttempting = connectionState === 'connecting' || connectionState === 'error';
  const { scheme, colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);

  // Seed the field with the last-used server on mount so it doesn't have to be
  // retyped every launch.
  useEffect(() => {
    let active = true;
    loadServerUrl().then((url) => {
      if (active) setServerUrl(url);
    });
    return () => {
      active = false;
    };
  }, []);

  const connect = () => {
    Keyboard.dismiss();
    socketService.connect(serverUrl);
  };

  return (
    <View>
      <View style={styles.header}>
        <Text style={styles.title}>OpenFlight</Text>
        <View style={styles.statusPill}>
          <View
            style={[styles.statusDot, { backgroundColor: colors[STATUS_COLOR[connectionState]] }]}
          />
          <Text style={styles.statusText}>{STATUS_LABEL[connectionState]}</Text>
        </View>
      </View>

      {isConnected ? (
        <View style={styles.connectedBar}>
          <TouchableOpacity
            style={styles.simulateButton}
            onPress={() => socketService.simulateShot()}
          >
            <Text style={styles.simulateButtonText}>Simulate Shot</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.disconnectButton}
            onPress={() => socketService.disconnect()}
          >
            <Text style={styles.disconnectButtonText}>Disconnect</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.connectRow}>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="http://<pi-ip>:8080"
            placeholderTextColor={colors.textFaint}
            keyboardAppearance={scheme}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
            onSubmitEditing={connect}
          />
          <TouchableOpacity
            style={styles.connectButton}
            onPress={connect}
            accessibilityRole="button"
            accessibilityLabel="Connect to server"
          >
            <Text style={styles.connectButtonText}>Connect</Text>
          </TouchableOpacity>
          {isAttempting ? (
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => socketService.disconnect()}
              accessibilityRole="button"
              accessibilityLabel="Stop connecting"
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}
    </View>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    title: {
      fontSize: 26,
      fontFamily: fontFamily.bold,
      color: c.text,
    },
    statusPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: spacing.xs,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    statusText: {
      fontSize: 12,
      fontFamily: fontFamily.medium,
      color: c.textMuted,
    },
    connectRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    input: {
      flex: 1,
      minHeight: 44,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.control,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: c.surface,
      color: c.text,
      fontFamily: fontFamily.regular,
      fontSize: 15,
    },
    connectButton: {
      minHeight: 44,
      backgroundColor: c.accentBlock,
      borderRadius: radius.control,
      paddingHorizontal: spacing.lg,
      justifyContent: 'center',
    },
    connectButtonText: {
      color: c.accentFg,
      fontFamily: fontFamily.semibold,
      fontSize: 15,
    },
    cancelButton: {
      minHeight: 44,
      borderRadius: radius.control,
      paddingHorizontal: spacing.lg,
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: c.border,
    },
    cancelButtonText: {
      color: c.text,
      fontFamily: fontFamily.semibold,
      fontSize: 15,
    },
    connectedBar: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    simulateButton: {
      flex: 1,
      minHeight: 44,
      backgroundColor: c.accentBlock,
      borderRadius: radius.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    simulateButtonText: {
      color: c.accentFg,
      fontFamily: fontFamily.semibold,
      fontSize: 15,
    },
    disconnectButton: {
      minHeight: 44,
      borderRadius: radius.control,
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: c.border,
    },
    disconnectButtonText: {
      color: c.text,
      fontFamily: fontFamily.semibold,
      fontSize: 15,
    },
  });
