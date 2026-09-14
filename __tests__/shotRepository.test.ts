import { createShotRepository, type ShotDatabase } from '../storage/shotRepository';
import type { Shot } from '../types';

// node:sqlite ships with the Node version this project pins, but an Expo app
// carries no Node type definitions, and adding @types/node would change global
// typings for the whole app (setTimeout's return type, among others). Requiring
// it against a local type keeps that blast radius inside this test.
interface TestStatement {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

interface TestDatabase {
  exec(source: string): void;
  prepare(source: string): TestStatement;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => TestDatabase;
};

// The repository is tested against a real SQLite database (node:sqlite, built
// into the Node version this project pins) rather than a mock, so the schema,
// the migration and every query actually run. On the device `expo-sqlite`
// supplies the same four methods; the adapter below is the only difference.
function openTestDatabase(): ShotDatabase {
  const db = new DatabaseSync(':memory:');
  return {
    execAsync: async (source: string) => {
      db.exec(source);
    },
    runAsync: async (source: string, params: unknown[] = []) => {
      db.prepare(source).run(...(params as never[]));
    },
    getAllAsync: async <T>(source: string, params: unknown[] = []) =>
      db.prepare(source).all(...(params as never[])) as T[],
    getFirstAsync: async <T>(source: string, params: unknown[] = []) =>
      (db.prepare(source).get(...(params as never[])) as T) ?? null,
  };
}

function makeShot(overrides: Partial<Shot> = {}): Shot {
  return {
    mode: 'rolling-buffer',
    ball_speed_mph: 148.2,
    club_speed_mph: 104.1,
    smash_factor: 1.42,
    estimated_carry_yards: 266,
    carry_spin_adjusted: 271,
    carry_range: [258, 274],
    club: 'driver',
    timestamp: '2026-09-14T10:00:00Z',
    launch_angle_vertical: 12.4,
    launch_angle_horizontal: -1.2,
    launch_angle_confidence: 0.8,
    angle_source: 'radar',
    club_angle_deg: -3.1,
    club_path_deg: 1.4,
    spin_axis_deg: -5.2,
    spin_rpm: 2680,
    spin_source: 'measured',
    spin_quality: 'medium',
    ...overrides,
  };
}

describe('shotRepository', () => {
  it('reads back a shot exactly as it was recorded', async () => {
    const repo = createShotRepository(openTestDatabase());
    await repo.init();
    const shot = makeShot();

    await repo.insertShot('session-1', shot);

    expect(await repo.loadShots('session-1')).toEqual([shot]);
  });

  it('keeps a missing measurement null instead of turning it into zero', async () => {
    // Optional metrics are genuinely absent on some shots; a 0 mph club speed
    // would read as a real measurement on screen.
    const repo = createShotRepository(openTestDatabase());
    await repo.init();

    await repo.insertShot(
      'session-1',
      makeShot({ club_speed_mph: null, smash_factor: null, spin_rpm: null, spin_quality: null }),
    );

    const [stored] = await repo.loadShots('session-1');
    expect(stored.club_speed_mph).toBeNull();
    expect(stored.smash_factor).toBeNull();
    expect(stored.spin_rpm).toBeNull();
    expect(stored.spin_quality).toBeNull();
  });

  it('returns a session newest-first, the order every screen wants', async () => {
    const repo = createShotRepository(openTestDatabase());
    await repo.init();

    await repo.insertShot('session-1', makeShot({ timestamp: '2026-09-14T10:00:00Z' }));
    await repo.insertShot('session-1', makeShot({ timestamp: '2026-09-14T10:05:00Z' }));
    await repo.insertShot('session-1', makeShot({ timestamp: '2026-09-14T10:02:00Z' }));

    const stored = await repo.loadShots('session-1');
    expect(stored.map((s) => s.timestamp)).toEqual([
      '2026-09-14T10:05:00Z',
      '2026-09-14T10:02:00Z',
      '2026-09-14T10:00:00Z',
    ]);
  });

  it("keeps one player's shots out of another's history", async () => {
    // The server stamps every shot with the profile it belongs to; dropping
    // that would blend two players' sessions together.
    const repo = createShotRepository(openTestDatabase());
    await repo.init();

    await repo.insertShot('session-1', makeShot(), { profileId: 'p1', profileName: 'Alex' });
    await repo.insertShot('session-1', makeShot(), { profileId: 'p2', profileName: 'Sam' });

    const sessions = await repo.loadSessions();
    expect(sessions[0].shotCount).toBe(2);
    expect(await repo.loadShots('session-1', { profileId: 'p1' })).toHaveLength(1);
  });

  it('lists past sessions newest-first with their shot counts', async () => {
    const repo = createShotRepository(openTestDatabase());
    await repo.init();

    await repo.insertShot('older', makeShot({ timestamp: '2026-09-13T09:00:00Z' }));
    await repo.insertShot('newer', makeShot({ timestamp: '2026-09-14T09:00:00Z' }));
    await repo.insertShot('newer', makeShot({ timestamp: '2026-09-14T09:30:00Z' }));

    const sessions = await repo.loadSessions();
    expect(sessions.map((s) => s.sessionId)).toEqual(['newer', 'older']);
    expect(sessions[0].shotCount).toBe(2);
    expect(sessions[0].lastShotAt).toBe('2026-09-14T09:30:00Z');
  });

  it('can be initialised twice without losing what is already stored', async () => {
    // init() runs on every launch; a migration that re-ran destructively would
    // wipe the player's history.
    const db = openTestDatabase();
    const repo = createShotRepository(db);
    await repo.init();
    await repo.insertShot('session-1', makeShot());

    await createShotRepository(db).init();

    expect(await repo.loadShots('session-1')).toHaveLength(1);
  });

  it('degrades to an empty history when the database is unavailable', async () => {
    // A storage fault must never take the app down or stall the live shot
    // pipeline, so every call swallows the failure and returns a safe value.
    const broken: ShotDatabase = {
      execAsync: async () => {
        throw new Error('disk I/O error');
      },
      runAsync: async () => {
        throw new Error('disk I/O error');
      },
      getAllAsync: async () => {
        throw new Error('disk I/O error');
      },
      getFirstAsync: async () => {
        throw new Error('disk I/O error');
      },
    };
    const repo = createShotRepository(broken);

    await expect(repo.init()).resolves.toBeUndefined();
    await expect(repo.insertShot('session-1', makeShot())).resolves.toBeUndefined();
    await expect(repo.loadShots('session-1')).resolves.toEqual([]);
    await expect(repo.loadSessions()).resolves.toEqual([]);
  });
});
