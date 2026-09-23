import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fontFamily } from '../../components/theme/fonts';
import { radius, spacing, type Palette } from '../../components/theme/tokens';
import { useThemedStyles } from '../../components/theme/useTheme';
import { requestShutdown } from '../../services/shutdown';
import { socketService } from '../../services/socket';
import { useDeviceStore } from '../../stores/useDeviceStore';
import { useSessionStore } from '../../stores/useSessionStore';
import type { PowerStatusPayload, TriggerStatusPayload } from '../../types';

// The troubleshooting lifeline for a Pi with no screen attached: what the
// hardware is doing, and a clean way to stop OpenFlight. Every value is shown as
// the server states it -- an absent measurement reads as an em dash, never as
// a zero, matching the Shots screen.

const MISSING = '—';

// How the server describes each power state. 'unavailable' is what a
// mains-powered Pi with no battery HAT reports, which is an answer rather than
// a missing reading.
const POWER_LABEL: Record<PowerStatusPayload['state'], string> = {
  plugged_in: 'Plugged in',
  on_battery: 'On battery',
  low: 'Battery low',
  critical: 'Battery critical',
  unavailable: 'No battery',
};

const MODE_LABEL: Record<TriggerStatusPayload['mode'], string> = {
  'rolling-buffer': 'Rolling buffer',
  mock: 'Mock mode',
  'swing-speed': 'Swing speed',
};

function Row({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function TriggerCard({ status }: { status: TriggerStatusPayload }) {
  const styles = useThemedStyles(createStyles);

  // The server reports radar_connected as `monitor is not None and not
  // mock_mode`, so it is false in mock mode even though everything works.
  // Calling that "offline" would send someone hunting a fault that is not
  // there, so the mode is what gets reported in that case.
  const radar =
    status.mode === 'mock' ? 'Simulated' : status.radar_connected ? 'Connected' : 'Not connected';

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Launch monitor</Text>
      <Row label="Mode" value={MODE_LABEL[status.mode]} />
      <Row label="Radar" value={radar} />
      <Row label="Port" value={status.radar_port ?? MISSING} />
      <Row label="Trigger" value={status.trigger_type ?? MISSING} />
      <Row label="Triggers seen" value={String(status.triggers_total)} />
      <Row label="Accepted" value={String(status.triggers_accepted)} />
      <Row label="Rejected" value={String(status.triggers_rejected)} />
    </View>
  );
}

function PowerCard({ status }: { status: PowerStatusPayload }) {
  const styles = useThemedStyles(createStyles);

  // A Pi without a battery provider still reports its absence. Showing 0%
  // there would look like a Pi about to die.
  const charge =
    status.battery_percent === null ? MISSING : `${Math.round(status.battery_percent)}%`;
  const voltage =
    status.battery_voltage_v === null ? MISSING : `${status.battery_voltage_v.toFixed(2)} V`;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Power</Text>
      <Row label="State" value={POWER_LABEL[status.state]} />
      {status.available ? <Row label="Charge" value={charge} /> : null}
      {status.available ? <Row label="Voltage" value={voltage} /> : null}
      <Row label="Provider" value={status.provider} />
      {status.error === null ? null : <Row label="Error" value={status.error} />}
    </View>
  );
}

// A labelled row with an action on the right. The server owns every one of
// these states, so the control never reflects the tap -- only what came back.
function ControlRow({
  label,
  detail,
  action,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  detail?: string;
  action: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.controlRow}>
      <View style={styles.controlText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {detail ? <Text style={styles.controlDetail}>{detail}</Text> : null}
      </View>
      <TouchableOpacity
        style={styles.controlButton}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        <Text style={styles.controlButtonText}>{action}</Text>
      </TouchableOpacity>
    </View>
  );
}

function DebugCard({ enabled, logPath }: { enabled: boolean; logPath: string | null }) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Diagnostics</Text>
      <ControlRow
        label="Debug recording"
        // The path is the only way to find the file again on a box with no
        // screen, so it is shown rather than merely "recording".
        detail={enabled ? undefined : 'Writes a diagnostic log on the Pi'}
        action={enabled ? 'Stop' : 'Start'}
        accessibilityLabel={enabled ? 'Stop debug recording' : 'Start debug recording'}
        onPress={() => socketService.toggleDebug()}
      />
      {enabled && logPath !== null ? <Text style={styles.controlDetail}>{logPath}</Text> : null}
    </View>
  );
}

type ShutdownPhase = 'idle' | 'confirming' | 'pending' | 'done' | 'failed';

// POST /api/shutdown stops the OpenFlight server process, not the Pi: the
// server cleans up its hardware and exits (_shutdown_process_after_delay in
// server.py) while the operating system keeps running. Everything here is
// worded as stopping OpenFlight so nobody reads it as safe to pull the power.
//
// Once a request has actually been sent, what happened to it outlives the
// connection: a successful stop takes the socket down with it ~0.5s after the
// server answers, and a refused one leaves OpenFlight running. Either way the
// message has to survive the drop that follows.
const INITIATED: ShutdownPhase[] = ['pending', 'done', 'failed'];

function ShutdownSection({ isConnected }: { isConnected: boolean }) {
  const styles = useThemedStyles(createStyles);
  const [phase, setPhase] = useState<ShutdownPhase>('idle');
  // The server the user confirmed stopping. A retry goes back to it rather than
  // to whatever is current: switching servers replaces the address before the
  // new one connects, and a stale "Try again" must not stop a Pi nobody
  // confirmed.
  const [target, setTarget] = useState<string | null>(null);

  // Declared before any early return: every hook in this component has to run
  // on every render, and hiding the section below used to skip this one, which
  // crashed React the first time the wifi dropped with nothing being stopped.
  const send = useCallback(async (url: string | null) => {
    setTarget(url);
    setPhase('pending');
    try {
      if (url === null) throw new Error('No server to stop');
      await requestShutdown(url);
      setPhase('done');
    } catch {
      // Saying OpenFlight stopped when it did not would leave the user
      // believing the server is down while it is still running.
      setPhase('failed');
    }
  }, []);

  // Nothing has been sent in 'idle' or 'confirming', so there is no outcome to
  // preserve and a confirm dialog for a Pi this phone is no longer talking to
  // would be misleading -- those collapse with the rest of the screen.
  if (!isConnected && !INITIATED.includes(phase)) return null;

  if (phase === 'pending') {
    return (
      <View style={styles.card}>
        <ActivityIndicator />
        <Text style={styles.note}>Stopping OpenFlight…</Text>
      </View>
    );
  }

  if (phase === 'done') {
    return (
      <View style={styles.card}>
        {/* The server answers before it exits, so this reports an accepted
            request rather than a server that has finished stopping. */}
        <Text style={styles.cardTitle}>Stopping OpenFlight</Text>
        <Text style={styles.note}>
          The server accepted the request and is exiting. The Pi itself stays on.
        </Text>
      </View>
    );
  }

  if (phase === 'failed') {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Could not stop OpenFlight</Text>
        <Text style={styles.note}>The server is still running.</Text>
        <TouchableOpacity
          style={styles.dangerButton}
          onPress={() => void send(target)}
          accessibilityRole="button"
          accessibilityLabel="Retry stopping OpenFlight"
        >
          <Text style={styles.dangerButtonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === 'confirming') {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Stop the OpenFlight server?</Text>
        <Text style={styles.note}>
          This exits the OpenFlight server. The Pi itself stays on, and the current session is not
          kept on it.
        </Text>
        <View style={styles.confirmRow}>
          <TouchableOpacity
            style={styles.dangerButton}
            // The address of the live connection, captured now so a retry
            // cannot drift to a server the user switched to afterwards.
            onPress={() => void send(socketService.currentUrl())}
            accessibilityRole="button"
            accessibilityLabel="Confirm stopping OpenFlight"
          >
            <Text style={styles.dangerButtonText}>Stop now</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => setPhase('idle')}
            accessibilityRole="button"
            accessibilityLabel="Cancel stopping OpenFlight"
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={styles.shutdownTrigger}
      onPress={() => setPhase('confirming')}
      accessibilityRole="button"
      accessibilityLabel="Stop OpenFlight"
    >
      <Text style={styles.shutdownTriggerText}>Stop OpenFlight</Text>
    </TouchableOpacity>
  );
}

export default function DeviceScreen() {
  const styles = useThemedStyles(createStyles);
  const connectionState = useSessionStore((s) => s.connectionState);
  // One connection span. It changes on every (re)connect, which is what tells
  // the shutdown panel that any outcome it is holding belongs to a past Pi.
  const sessionId = useSessionStore((s) => s.sessionId);
  const triggerStatus = useDeviceStore((s) => s.triggerStatus);
  const powerStatus = useDeviceStore((s) => s.powerStatus);
  const triggerLoaded = useDeviceStore((s) => s.triggerLoaded);
  const powerLoaded = useDeviceStore((s) => s.powerLoaded);
  const debugEnabled = useDeviceStore((s) => s.debugEnabled);
  const debugLogPath = useDeviceStore((s) => s.debugLogPath);
  const debugLoaded = useDeviceStore((s) => s.debugLoaded);

  const isConnected = connectionState === 'connected';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Device</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {isConnected ? (
          <>
            {/* "Nothing reported yet" is not the same claim as "this Pi has no
                radar", so an unanswered request waits rather than showing an
                empty state. */}
            {triggerLoaded && triggerStatus !== null ? (
              <TriggerCard status={triggerStatus} />
            ) : (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Launch monitor</Text>
                <Text style={styles.note}>Waiting for the server to report…</Text>
              </View>
            )}

            {powerLoaded && powerStatus !== null ? <PowerCard status={powerStatus} /> : null}

            {/* Nothing until the Pi has answered: debug mode is server-global,
                so the default "off" could contradict a session that is already
                recording, and a Start that actually stops a capture is worse
                than a card that appears a moment late. */}
            {debugLoaded ? <DebugCard enabled={debugEnabled} logPath={debugLogPath} /> : null}
          </>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Not connected</Text>
            <Text style={styles.emptyDetail}>
              Connect to a server on the Live tab to see how it is doing.
            </Text>
          </View>
        )}

        {/* Deliberately outside the connection branch: a stop that has been
            sent takes the connection down with it, and its outcome is what the
            user needs to read at exactly that moment. The section renders
            nothing itself while idle and disconnected.

            Keyed on the session so a new connection remounts it, dropping an
            outcome that described the previous one -- "exiting" beside live
            status from a server that is plainly back, or a stale "Try again".
            A transient drop keeps the same session, so a request still in
            flight is left alone. */}
        <ShutdownSection key={sessionId ?? 'no-session'} isConnected={isConnected} />
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: c.bg,
    },
    header: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
    },
    title: {
      fontSize: 24,
      fontFamily: fontFamily.bold,
      color: c.text,
    },
    content: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xl,
    },
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: spacing.lg,
      marginBottom: spacing.md,
    },
    cardTitle: {
      fontSize: 12,
      fontFamily: fontFamily.semibold,
      color: c.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 36,
    },
    rowLabel: {
      fontSize: 14,
      fontFamily: fontFamily.regular,
      color: c.textMuted,
    },
    rowValue: {
      fontSize: 14,
      fontFamily: fontFamily.semibold,
      fontVariant: ['tabular-nums'],
      color: c.text,
    },
    note: {
      fontSize: 13,
      fontFamily: fontFamily.regular,
      color: c.textMuted,
      marginTop: spacing.xs,
    },
    controlRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      minHeight: 48,
    },
    controlText: {
      flex: 1,
    },
    controlDetail: {
      fontSize: 12,
      fontFamily: fontFamily.regular,
      color: c.textMuted,
      marginTop: 2,
    },
    controlButton: {
      minHeight: 44,
      minWidth: 88,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
    },
    controlButtonText: {
      fontSize: 14,
      fontFamily: fontFamily.semibold,
      color: c.text,
    },
    shutdownTrigger: {
      minHeight: 48,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: c.danger,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing.sm,
    },
    shutdownTriggerText: {
      fontSize: 15,
      fontFamily: fontFamily.semibold,
      color: c.danger,
    },
    confirmRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    dangerButton: {
      flex: 1,
      minHeight: 48,
      borderRadius: radius.control,
      backgroundColor: c.danger,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dangerButtonText: {
      fontSize: 15,
      fontFamily: fontFamily.semibold,
      color: c.accentFg,
    },
    cancelButton: {
      minHeight: 48,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelButtonText: {
      fontSize: 15,
      fontFamily: fontFamily.semibold,
      color: c.text,
    },
    empty: {
      alignItems: 'center',
      paddingTop: 48,
      gap: spacing.xs,
    },
    emptyTitle: {
      fontSize: 16,
      fontFamily: fontFamily.semibold,
      color: c.text,
    },
    emptyDetail: {
      fontSize: 13,
      fontFamily: fontFamily.regular,
      color: c.textMuted,
      textAlign: 'center',
    },
  });
