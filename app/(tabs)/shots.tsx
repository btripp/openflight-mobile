import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getShotRepository } from '../../storage/db';
import type { SessionSummary } from '../../storage/shotRepository';
import type { Shot } from '../../types';

// Shot history kept on the device, readable with no simulator in sight. The
// columns and stat tiles mirror the kiosk's Shots and Stats panels so both
// interfaces describe a session the same way.

// Matches the kiosk: speeds to one decimal, carry rounded, smash to two, and an
// em dash wherever a measurement is genuinely absent.
const MISSING = '—';

function speed(value: number | null): string {
  return value === null ? MISSING : value.toFixed(1);
}

function distance(value: number | null): string {
  return value === null ? MISSING : Math.round(value).toString();
}

function spin(value: number | null): string {
  return value === null ? MISSING : Math.round(value).toLocaleString('en-US');
}

function angle(value: number | null): string {
  return value === null ? MISSING : value.toFixed(1);
}

function sessionTitle(session: SessionSummary): string {
  const started = new Date(session.firstShotAt);
  return Number.isNaN(started.getTime())
    ? session.sessionId
    : started.toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
}

function shotTime(timestamp: string): string {
  const at = new Date(timestamp);
  return Number.isNaN(at.getTime())
    ? timestamp
    : at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

interface SessionStats {
  count: number;
  avgBall: number | null;
  maxBall: number | null;
  avgCarry: number | null;
  avgClub: number | null;
  avgSmash: number | null;
}

// The kiosk's six-tile summary, computed from the stored shots rather than from
// the server's stats payload — that only ever describes the live session.
function summarise(shots: Shot[]): SessionStats {
  const mean = (values: number[]) =>
    values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
  const present = <T,>(values: (T | null)[]) =>
    values.filter((value): value is T => value !== null);

  const ballSpeeds = shots.map((shot) => shot.ball_speed_mph);
  return {
    count: shots.length,
    avgBall: mean(ballSpeeds),
    maxBall: ballSpeeds.length === 0 ? null : Math.max(...ballSpeeds),
    avgCarry: mean(shots.map((shot) => shot.estimated_carry_yards)),
    avgClub: mean(present(shots.map((shot) => shot.club_speed_mph))),
    avgSmash: mean(present(shots.map((shot) => shot.smash_factor))),
  };
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

function SessionStatsGrid({ stats }: { stats: SessionStats }) {
  return (
    <View style={styles.tiles} testID="session-stats">
      <StatTile label="Shots" value={String(stats.count)} />
      <StatTile label="Avg ball" value={speed(stats.avgBall)} />
      <StatTile label="Max ball" value={speed(stats.maxBall)} />
      <StatTile label="Avg carry" value={distance(stats.avgCarry)} />
      <StatTile label="Avg club" value={speed(stats.avgClub)} />
      <StatTile
        label="Avg smash"
        value={stats.avgSmash === null ? MISSING : stats.avgSmash.toFixed(2)}
      />
    </View>
  );
}

function ShotRow({ shot }: { shot: Shot }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.rowClub}>{shot.club}</Text>
        <Text style={styles.rowTime}>{shotTime(shot.timestamp)}</Text>
      </View>
      <Text style={styles.cell}>{speed(shot.ball_speed_mph)}</Text>
      <Text style={styles.cell}>{speed(shot.club_speed_mph)}</Text>
      <Text style={styles.cell}>{angle(shot.launch_angle_vertical)}</Text>
      <Text style={styles.cell}>{spin(shot.spin_rpm)}</Text>
      <Text style={styles.cell}>{distance(shot.estimated_carry_yards)}</Text>
    </View>
  );
}

function EmptyHistory() {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>No shots yet</Text>
      <Text style={styles.emptyDetail}>Recorded shots appear here</Text>
    </View>
  );
}

export default function ShotsScreen() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [openSession, setOpenSession] = useState<SessionSummary | null>(null);
  const [shots, setShots] = useState<Shot[] | null>(null);

  // History is read on mount; the repository degrades to an empty list rather
  // than throwing, so there is no error branch to render.
  useEffect(() => {
    let active = true;
    void (async () => {
      const repository = await getShotRepository();
      const stored = await repository.loadSessions();
      if (active) setSessions(stored);
    })();
    return () => {
      active = false;
    };
  }, []);

  const open = useCallback(async (session: SessionSummary) => {
    setOpenSession(session);
    setShots(null);
    const repository = await getShotRepository();
    setShots(await repository.loadShots(session.sessionId));
  }, []);

  if (openSession !== null) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => setOpenSession(null)}
            accessibilityRole="button"
            accessibilityLabel="Back to sessions"
          >
            <Text style={styles.back}>Sessions</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{sessionTitle(openSession)}</Text>
        </View>

        {shots === null ? (
          <ActivityIndicator style={styles.loading} />
        ) : (
          <FlatList
            data={shots}
            keyExtractor={(shot, index) => `${shot.timestamp}-${index}`}
            ListHeaderComponent={
              <>
                <SessionStatsGrid stats={summarise(shots)} />
                <View style={styles.columns}>
                  <Text style={[styles.columnLabel, styles.columnShot]}>Shot</Text>
                  <Text style={styles.columnLabel}>Ball</Text>
                  <Text style={styles.columnLabel}>Club</Text>
                  <Text style={styles.columnLabel}>Launch</Text>
                  <Text style={styles.columnLabel}>Spin</Text>
                  <Text style={styles.columnLabel}>Carry</Text>
                </View>
              </>
            }
            renderItem={({ item }) => <ShotRow shot={item} />}
            ListEmptyComponent={<EmptyHistory />}
          />
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Shots</Text>
      </View>

      {sessions === null ? (
        <ActivityIndicator style={styles.loading} />
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(session) => session.sessionId}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.session}
              onPress={() => void open(item)}
              accessibilityRole="button"
            >
              <View>
                <Text style={styles.sessionTitle}>{sessionTitle(item)}</Text>
                <Text style={styles.sessionDetail}>{shotTime(item.firstShotAt)}</Text>
              </View>
              <Text style={styles.sessionCount}>
                {item.shotCount} {item.shotCount === 1 ? 'shot' : 'shots'}
              </Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<EmptyHistory />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  back: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0969da',
    paddingVertical: 8,
  },
  loading: {
    marginTop: 32,
  },
  session: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e1e4e8',
  },
  sessionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  sessionDetail: {
    fontSize: 12,
    color: '#999',
  },
  sessionCount: {
    fontSize: 14,
    color: '#666',
  },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  tile: {
    width: '33.33%',
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  tileValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  tileLabel: {
    fontSize: 11,
    color: '#666',
    textTransform: 'uppercase',
  },
  columns: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e1e4e8',
  },
  columnLabel: {
    flex: 1,
    fontSize: 11,
    color: '#999',
    textTransform: 'uppercase',
    textAlign: 'right',
  },
  columnShot: {
    flex: 1.6,
    textAlign: 'left',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f2f4',
  },
  rowHead: {
    flex: 1.6,
  },
  rowClub: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  rowTime: {
    fontSize: 11,
    color: '#999',
  },
  cell: {
    flex: 1,
    fontSize: 14,
    color: '#1a1a1a',
    textAlign: 'right',
  },
  empty: {
    alignItems: 'center',
    paddingTop: 48,
    gap: 4,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  emptyDetail: {
    fontSize: 13,
    color: '#999',
  },
});
