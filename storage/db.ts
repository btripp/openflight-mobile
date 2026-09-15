import * as SQLite from 'expo-sqlite';
import { createShotRepository, type ShotDatabase, type ShotRepository } from './shotRepository';

// Opens the on-device database and hands back the shot repository. Kept apart
// from shotRepository.ts so the repository stays free of Expo imports and can be
// tested against a real SQLite database in Node.

const DATABASE_NAME = 'openflight.db';

// A database that refuses every call. Used when the file cannot be opened at
// all, so callers get an empty history instead of a rejected promise — the same
// degrade-never-throw contract the repository itself keeps.
const UNAVAILABLE: ShotDatabase = {
  execAsync: () => Promise.reject(new Error('database unavailable')),
  runAsync: () => Promise.reject(new Error('database unavailable')),
  getAllAsync: () => Promise.reject(new Error('database unavailable')),
  getFirstAsync: () => Promise.reject(new Error('database unavailable')),
};

function adapt(db: SQLite.SQLiteDatabase): ShotDatabase {
  return {
    execAsync: (source) => db.execAsync(source),
    runAsync: (source, params = []) => db.runAsync(source, params as SQLite.SQLiteBindParams),
    getAllAsync: <T>(source: string, params: unknown[] = []) =>
      db.getAllAsync<T>(source, params as SQLite.SQLiteBindParams),
    getFirstAsync: <T>(source: string, params: unknown[] = []) =>
      db.getFirstAsync<T>(source, params as SQLite.SQLiteBindParams),
  };
}

// Memoised: opening and migrating happens once per app launch, and every caller
// awaits the same promise rather than racing to create a second connection.
let repository: Promise<ShotRepository> | null = null;

export function getShotRepository(): Promise<ShotRepository> {
  repository ??= (async () => {
    let database: ShotDatabase;
    try {
      database = adapt(await SQLite.openDatabaseAsync(DATABASE_NAME));
    } catch {
      database = UNAVAILABLE;
    }
    const repo = createShotRepository(database);
    await repo.init();
    return repo;
  })();
  return repository;
}
