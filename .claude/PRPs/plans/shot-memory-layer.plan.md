# Plan: The Shot Memory Layer

## Summary

Extend the existing `ROADMAP.md` with a persistence-and-analysis layer that turns the
mobile app from a live mirror of the kiosk into the thing commercial launch-monitor apps
actually sell: session history, club gapping, per-metric baselines, and dispersion. This
plan **extends** the locked roadmap decisions rather than replacing them — Phase 0 stays
as shipped, Phase 1/2 items are re-ordered and augmented, and nothing here contradicts
the "self-contained mobile app, mirrored wire contract" principle.

## User Story

As a builder running OpenFlight on a headless Pi,
I want my shots to persist across sessions and be summarised per club,
So that I can find gaps in my bag and see whether I'm actually improving —
without a cloud account or a subscription.

## Problem → Solution

**Current state:** shots live in a Zustand store (`stores/useSessionStore.ts`) and are
discarded on disconnect. The app answers "what did that shot do?" and nothing else.

**Desired state:** shots are persisted locally, aggregated per club, and rendered against
the player's own rolling averages, with dispersion and honest confidence disclosure.

## Metadata

- **Complexity**: XL overall (split into 5 phases); **Phase A alone is Medium**
- **Source PRD**: N/A — derived from the competitive research artifact, 4 Sep 2026
- **PRD Phase**: N/A (standalone; extends `ROADMAP.md`)
- **Estimated Files**: Phase A ≈ 7 files; full arc ≈ 30+

---

## Why this plan exists (the competitive case, for maintainers)

Three findings from the market research drive everything below:

1. **The phone app is never the simulator.** TrackMan's app is `Me / Activity /
   Competitions / Locations`; the simulator is TrackMan Performance Studio on a PC at
   $700–1,100/yr. Full Swing's app is `Play / Activity / Stats`. Both phone apps are
   *memory* — history, gapping, dispersion, progress.
2. **Simulation is already solved here.** The upstream server ships a working GSPro
   connector (`src/openflight/gspro/`). The app does not need to chase course play.
3. **The wire contract already carries confidence data nobody else exposes.**
   `spin_quality`, `launch_angle_confidence`, `angle_source`, `spin_source` are typed in
   `types.ts` and currently unrendered. No commercial monitor shows its own uncertainty.

---

## Options to decide (maintainer input needed)

These are genuine forks. Recommendations given, but they are the maintainers' call.

### Option 1 — Persistence engine

| Option | Pros | Cons | Recommendation |
|---|---|---|---|
| **A. AsyncStorage (JSON blob)** | Already a dependency (`2.2.0`); zero new packages; mirrors `storage/connection.ts` exactly | Whole-list read/write per mutation; Android has a default ~6 MB store limit; no querying — every aggregate is a full deserialise + scan | Ship-fast option |
| **B. `expo-sqlite`** | Real queries and aggregates; scales to years of shots; first-party SDK 54 module so it works inside Expo Go | One new dependency; needs a tiny migration story | **Recommended** |

**Rationale:** gapping and averages are `GROUP BY club` queries. Doing them by scanning a
JSON blob works at 200 shots and stops working at 20,000. Since `expo-sqlite` is
first-party it does *not* break the `AGENTS.md` Expo Go pin.

### Option 2 — Distribution / the Expo Go constraint

`AGENTS.md` pins SDK 54 to the maintainer's Expo Go. That constraint decides what is
buildable.

| Option | Consequence | Recommendation |
|---|---|---|
| **A. Stay pure Expo Go** | Everything in Phases A–D is reachable — `expo-sqlite`, `expo-speech`, `expo-file-system`, `expo-sharing`, `react-native-svg` are all first-party SDK 54 modules bundled in Expo Go | **Recommended through Phase D** |
| **B. Adopt EAS development builds** | Unlocks mDNS/zeroconf discovery and BLE; costs a build pipeline and an onboarding step for every contributor | Only when Phase E discovery lands — the existing roadmap already flags this risk |

### Option 3 — Charting

| Option | Notes | Recommendation |
|---|---|---|
| **A. `react-native-svg` by hand** | First-party in the Expo SDK; dispersion is ellipses + rings, gapping is bars — both are ~80 lines of SVG | **Recommended** — no new runtime dep, full control |
| **B. `victory-native`** | More capable, heavier, and the modern build wants Skia | Reconsider only if charts multiply |

### Option 4 — Sync posture

| Option | Notes | Recommendation |
|---|---|---|
| **A. Local-only + export** | No account, no server, no privacy surface. The inverse of the $100/yr cloud upsell — a marketable position, not a limitation | **Recommended** |
| **B. Optional Grafana Cloud sync** | The upstream setup script already offers cloud sync; power-user analytics no commercial LM offers | Phase E, opt-in only |
| **C. First-party OpenFlight backend** | — | **Reject.** Volunteer project; recurring cost and liability |

### Option 5 — Scope posture

- **Parity:** match the sub-$1K tier. Phases A–C.
- **Leapfrog:** A–C plus the things only an open project can do — confidence disclosure,
  data export, spoken shots. **Recommended**, because parity alone loses to a $699 device
  with a polished app and a warranty.

---

## UX Design

### Before

```
┌──────────────────────────────┐
│  Live  Shots  Stats  Device  │   Shots/Stats/Device are
├──────────────────────────────┤   PlaceholderScreen stubs
│   [ connection bar ]         │
│                              │
│      241 yds                 │   One shot. No context.
│      CARRY                   │   Disconnect → gone.
│      240–260 yds             │
│                              │
│   [ Simulate ]               │
└──────────────────────────────┘
```

### After

```
┌──────────────────────────────┐   ┌──────────────────────────────┐
│  Live  Shots  Stats  Device  │   │  Stats ▸ Club Analysis       │
├──────────────────────────────┤   ├──────────────────────────────┤
│   241 yds        ▲ +3 vs avg │   │  Lifetime · Carry  4,329 sh. │
│   CARRY                      │   │                              │
│   240–260 yds    ●●○ medium  │   │  Dr   ███████████████  278   │
│                              │   │            ── 19 yds gap ──  │
│   152.4 mph      ▼ −1.2      │   │  3W   ████████████     259   │
│   BALL SPEED                 │   │            ── 6 yds gap ──   │
│                              │   │  5W   ███████████      253   │
│   ⏱ 34 shots this session    │   │            ── 18 yds gap ──  │
│   🔊 "241 yards, 152 mile…"  │   │  3H   █████████        235   │
└──────────────────────────────┘   └──────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Shot arrives | Tile shows a number | Tile shows number + delta vs your average | Needs history |
| Disconnect | Session lost | Session persisted, resumable | Phase A |
| Shots tab | Placeholder | Session list, drill into any shot | Phase B |
| Stats tab | Placeholder | Gapping + dispersion | Phase B |
| Eyes on the mat | Must look at phone | Shot spoken aloud | Phase C — the headless case |
| Spin/angle tiles | Bare number | Number + quality dots (already built in `MetricTile`) | `confidence` prop exists and is unused for spin |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `stores/useSessionStore.ts` | all (33) | The single writer/reader contract every new feature plugs into |
| P0 | `services/socket.ts` | all (88) | Where shots enter the app; the only place to hook persistence |
| P0 | `storage/connection.ts` | all (31) | **The exact persistence idiom to mirror** — try/catch, never throws, module-level key const |
| P0 | `types.ts` | 1–40 | `Shot` shape; note `carry_range` is a tuple and several fields are nullable |
| P1 | `__tests__/socket.test.ts` | 1–45 | Mock-factory-inside-`jest.mock` idiom (TDZ workaround) and the AsyncStorage mock |
| P1 | `components/MetricTile.tsx` | 1–45 | `confidence` prop + dot rendering already exists — reuse, don't rebuild |
| P1 | `app/(tabs)/_layout.tsx` | all (45) | Tab registration; accent `#1a7f37` |
| P2 | `ROADMAP.md` | all | Locked decisions; this plan must not contradict them |
| P2 | `AGENTS.md` | all | SDK 54 pin — the hard constraint |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| SDK 54 API list | `docs.expo.dev/versions/v54.0.0/` | `expo-sqlite`, `expo-speech`, `expo-file-system`, `expo-sharing` all present in SDK 54 |
| Expo Go module availability | Expo docs | First-party `expo-*` modules ship inside Expo Go; **third-party** native modules (zeroconf/BLE) require a dev build — matches the mDNS risk already noted in `ROADMAP.md` Phase 2 |

```
KEY_INSIGHT: Every module Phases A–D need is first-party Expo SDK.
APPLIES_TO: Options 1, 2, 3 — the whole plan stays inside the Expo Go pin.
GOTCHA: Verify empirically in Task A0 before building on it. Do not assume.
```

---

## Patterns to Mirror

### PERSISTENCE_IDIOM
```ts
// SOURCE: storage/connection.ts:3-31
const SERVER_URL_KEY = 'openflight.serverUrl';

export async function loadServerUrl(): Promise<string> {
  try {
    const saved = await AsyncStorage.getItem(SERVER_URL_KEY);
    return saved ?? DEFAULT_SERVER_URL;
  } catch {
    return DEFAULT_SERVER_URL;
  }
}
```
**Rules extracted:** module-level `openflight.`-prefixed key constants; every storage
function is `async` and **never throws**; failure degrades to a default. New persistence
code must keep this — a storage fault must never break the shot pipeline.

### STORE_PATTERN
```ts
// SOURCE: stores/useSessionStore.ts:26-33
export const useSessionStore = create<SessionState>((set) => ({
  connectionState: 'disconnected',
  shots: [],
  setConnectionState: (state) => set({ connectionState: state }),
  setShots: (serverShots) => set({ shots: [...serverShots].reverse() }),
  addShot: (shot) => set((prev) => ({ shots: [shot, ...prev.shots] })),
  clearShots: () => set({ shots: [] }),
}));
```
**Rules:** zustand `create` with inline actions; shots held **newest-first**; server sends
oldest-first and `setShots` inverts. Copy before mutating (`[...serverShots]`).

### SERVICE_SINGLETON
```ts
// SOURCE: services/socket.ts:16-17, 86
class SocketService {
  private socket: Socket | null = null;
  // ...
}
export const socketService = new SocketService();
```
**Rules:** class with private state, exported as a single instance; lives outside the
React tree; `useSessionStore.getState()` (not hooks) for writes.

### EVENT_TO_STORE_MAPPING
```ts
// SOURCE: services/socket.ts:70-78
socket.on('session_state', (data: SessionStatePayload) => {
  store().setShots(data.shots);
});
socket.on('shot', (data: ShotEnvelope) => {
  store().addShot(data.shot);
});
```
**Rules:** one handler per server event, each a single store call. Persistence hooks in
**here**, not in components.

### COMPONENT_PATTERN
```ts
// SOURCE: components/MetricTile.tsx:5-17
type TileVariant = 'primary' | 'secondary' | 'spin';

interface MetricTileProps {
  value: string | number;
  unit?: string;
  label: string;
  confidence?: AngleQuality | SpinQuality | null;
}
export function MetricTile({ value, unit, label, variant = 'secondary' }: MetricTileProps) {
```
**Rules:** named exports (not default) for components; `interface XProps`; local union
types; `StyleSheet.create` at file bottom; no external UI library.

### TEST_STRUCTURE
```ts
// SOURCE: __tests__/socket.test.ts:11-27
jest.mock('socket.io-client', () => {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  // built INSIDE the factory — an outer const is still in TDZ at import time
  return { io, __mock: { handlers, emit, close } };
});
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
```
**Rules:** tests in `__tests__/*.test.ts`; mock internals built inside the factory and
retrieved via `jest.requireMock`; a `makeShot(timestamp)` helper builds full `Shot`
fixtures. **New DB code needs the same treatment** — mock `expo-sqlite` in-factory.

---

## Phased Delivery

Each phase is independently shippable and independently valuable. Maintainers can stop
after any one.

### Phase A — Persistence foundation `Medium` · gates everything

Local shot store. Little visible change; makes B–E possible.

| Work item | Files |
|---|---|
| SQLite schema + migration runner | `storage/db.ts` (new) |
| Shot repository (insert, query by session/club, aggregates) | `storage/shotRepository.ts` (new) |
| Persist on `shot`; hydrate on launch | `services/socket.ts` (update) |
| Session identity (a session = a connection span) | `stores/useSessionStore.ts` (update) |
| Repository + migration tests | `__tests__/shotRepository.test.ts` (new) |

### Phase B — The memory layer `Large` · the competitive core

| # | Feature | Depends on |
|---|---|---|
| 1 | Shots tab: session list → shot detail | A |
| 2 | **Club gapping** — avg carry per club, sorted, gaps between adjacent clubs | A |
| 3 | **Metric vs. your average** on every live tile | A |
| 4 | Dispersion chart — `launch_angle_horizontal` × carry, per club | A |
| 5 | Unit toggle (imperial/metric), persisted | — (roadmap item 5) |

### Phase C — Sole-interface completeness `Medium` · the existing Phase 2, plus voice

Graceful shutdown, Device/status view, connection bootstrapping — **as already specced in
`ROADMAP.md` Phase 2** — plus:

| # | Feature | Notes |
|---|---|---|
| 4 | **Spoken shot readout** (`expo-speech`) | Full Swing ships this; it fits OpenFlight's headless thesis better than it fits theirs |

### Phase D — Differentiators `Medium` · what only an open project can ship

| # | Feature | Notes |
|---|---|---|
| 1 | Confidence surfacing on spin/angle tiles | `MetricTile` already accepts `confidence`; wire `spin_quality` + `angle_source` through |
| 2 | Session export (CSV/JSON) via `expo-file-system` + `expo-sharing` | The open answer to a cloud subscription |
| 3 | Normalised distances (altitude/temp) | Server already runs a ballistic model |

### Phase E — Stretch `L–XL` · explicitly optional

Phone-camera swing video; swing-speed mode (`--swing-speed` exists server-side);
opt-in Grafana Cloud sync; mDNS discovery (**requires the dev-build decision**).

### Explicitly NOT building

- Course play, venue booking, competitions, leaderboards — GSPro covers course play and
  covers it better than a volunteer project would.
- A first-party cloud backend or user accounts.
- Any Expo SDK upgrade (`AGENTS.md`).
- Sharing types with the web `ui/` — the mirrored contract is a locked decision.
- Swing video in Phases A–D.

---

## Step-by-Step Tasks — Phase A only

Phases B–E get their own plans once A lands and the maintainers have weighed in on the
options above.

### Task A0: Verify the Expo Go assumption
- **ACTION**: Prove `expo-sqlite` loads in SDK 54 Expo Go before building on it.
- **IMPLEMENT**: `npx expo install expo-sqlite`; temporary screen calling
  `SQLite.openDatabaseAsync('probe.db')`; run on the maintainer's Expo Go.
- **GOTCHA**: If this fails, **stop** and fall back to Option 1A (AsyncStorage). Do not
  proceed to A1 on an unverified assumption.
- **VALIDATE**: App opens in Expo Go; no "native module not found"; then revert the probe.

### Task A1: Schema + migration runner
- **ACTION**: Create `storage/db.ts`.
- **IMPLEMENT**: `getDb()` returning a memoised `SQLite.openDatabaseAsync` handle; a
  `user_version`-based migration runner; v1 schema:
  ```sql
  CREATE TABLE shots (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    TEXT    NOT NULL,
    timestamp     TEXT    NOT NULL,
    club          TEXT    NOT NULL,
    mode          TEXT,
    ball_speed_mph        REAL NOT NULL,
    club_speed_mph        REAL,
    smash_factor          REAL,
    estimated_carry_yards REAL NOT NULL,
    carry_spin_adjusted   REAL,
    carry_range_low       REAL NOT NULL,
    carry_range_high      REAL NOT NULL,
    launch_angle_vertical    REAL,
    launch_angle_horizontal  REAL,
    launch_angle_confidence  REAL,
    angle_source  TEXT,
    spin_rpm      REAL,
    spin_source   TEXT,
    spin_quality  TEXT
  );
  CREATE INDEX idx_shots_club    ON shots(club);
  CREATE INDEX idx_shots_session ON shots(session_id);
  ```
- **MIRROR**: PERSISTENCE_IDIOM — wrap in try/catch, never throw.
- **IMPORTS**: `import * as SQLite from 'expo-sqlite';`
- **GOTCHA**: `carry_range` is a **tuple** `[number, number]` in `types.ts` — flatten to
  two columns and reassemble on read. Several fields are legitimately `null`; only
  `ball_speed_mph`, `estimated_carry_yards`, `club`, `timestamp` are non-null.
- **VALIDATE**: `npx tsc --noEmit`; migration runs twice without error (idempotent).

### Task A2: Shot repository
- **ACTION**: Create `storage/shotRepository.ts`.
- **IMPLEMENT**:
  - `insertShot(sessionId: string, shot: Shot): Promise<void>`
  - `loadRecentShots(limit = 200): Promise<Shot[]>` — newest-first, matching the store invariant
  - `loadSessions(): Promise<SessionSummary[]>`
  - `clubAverages(): Promise<ClubAverage[]>` — `SELECT club, AVG(...), COUNT(*) ... GROUP BY club ORDER BY 2 DESC`
  - `clearAll(): Promise<void>`
- **MIRROR**: PERSISTENCE_IDIOM exactly — every function async, try/catch, degrade to `[]`.
- **GOTCHA**: Return newest-first so `setShots` is **not** used (it reverses). Hydrate via
  `useSessionStore.setState({ shots })` directly, or the list ends up backwards.
- **VALIDATE**: `__tests__/shotRepository.test.ts` covers insert→read round-trip, null
  preservation, tuple reassembly, and `clubAverages` grouping.

### Task A3: Session identity
- **ACTION**: Update `stores/useSessionStore.ts`.
- **IMPLEMENT**: Add `sessionId: string | null` and `startSession()` (sets a
  `Date.now()`-based id). A session = one connection span.
- **MIRROR**: STORE_PATTERN — inline action in the `create` call.
- **GOTCHA**: Do **not** import storage into the store; the store stays framework-agnostic
  and unit-testable (its header comment says so).
- **VALIDATE**: Extend `__tests__/useSessionStore.test.ts`.

### Task A4: Hook persistence into the socket service
- **ACTION**: Update `services/socket.ts`.
- **IMPLEMENT**: In the `connect` handler call `store().startSession()`. In the `shot`
  handler, after `addShot`, fire `void insertShot(sessionId, data.shot)`.
- **MIRROR**: EVENT_TO_STORE_MAPPING — persistence rides alongside the store call.
- **GOTCHA**: Use `void` (fire-and-forget), never `await`. A slow disk write must not
  delay the live tile. This is why the repository never throws.
- **VALIDATE**: Extend `__tests__/socket.test.ts` — assert `insertShot` called once per
  `shot` event with the mocked repository.

### Task A5: Hydrate on launch
- **ACTION**: Update `app/_layout.tsx`.
- **IMPLEMENT**: On mount, `loadRecentShots()` → `useSessionStore.setState({ shots })`.
- **GOTCHA**: `session_state` on connect calls `setShots`, which **replaces** the list with
  server-session shots only. Decide explicitly: server session is the live list, local
  history is a separate read path for Shots/Stats. Do not let hydration and `session_state`
  fight over `shots`.
- **VALIDATE**: Kill and relaunch the app offline; history is still readable.

---

## Testing Strategy

| Test | Input | Expected | Edge case? |
|---|---|---|---|
| Insert → read round-trip | One full `Shot` | Identical object, tuple reassembled | — |
| Null preservation | `spin_rpm: null` | Reads back `null`, not `0` | yes |
| Newest-first ordering | 3 shots, ascending timestamps | Index 0 is latest | yes |
| `clubAverages` grouping | 5 driver, 3 7-iron | 2 rows, correct counts | — |
| Migration idempotency | Run runner twice | No error, `user_version` stable | yes |
| Storage failure | DB throws | `loadRecentShots` → `[]`, no crash | yes |
| Persistence non-blocking | `insertShot` rejects | `addShot` still ran; tile rendered | yes |
| Empty history | Fresh install | Stats/Shots render an empty state | yes |

### Edge cases checklist
- [ ] Empty database on first launch
- [ ] Shot with every nullable field null
- [ ] `mode: 'swing-speed'` (no ball-flight data — see the open PR review finding)
- [ ] Disk full / write rejected
- [ ] Rapid shots (simulate spam) — no lost writes
- [ ] Reconnect to a *different* server mid-session

---

## Validation Commands

```bash
npx tsc --noEmit          # EXPECT: zero type errors
npm test                  # EXPECT: all pass (20 existing + new)
npx expo-doctor           # EXPECT: 18/18 (a new dep must not regress this)
npm start                 # EXPECT: loads in SDK 54 Expo Go; connect, hit, relaunch, history persists
```

### Manual validation
- [ ] Connect, take 5 shots, force-quit, relaunch → the 5 shots are still there
- [ ] Disconnect and reconnect → no duplicates
- [ ] Airplane mode → app opens, history readable, no crash
- [ ] Verified on the maintainer's actual SDK 54 Expo Go, not just a simulator

---

## Acceptance Criteria (Phase A)
- [ ] Task A0 verified before any other task begins
- [ ] Shots survive a force-quit and relaunch
- [ ] `clubAverages()` returns correct per-club aggregates
- [ ] A storage failure never breaks the live shot pipeline
- [ ] `npx tsc --noEmit` clean, `npm test` green, `expo-doctor` still 18/18

## Completion Checklist
- [ ] Code follows PERSISTENCE_IDIOM, STORE_PATTERN, EVENT_TO_STORE_MAPPING
- [ ] Tests use the in-factory mock idiom from `__tests__/socket.test.ts`
- [ ] No Expo SDK upgrade
- [ ] No hardcoded values (keys as module consts, `openflight.`-prefixed)
- [ ] `ROADMAP.md` updated to reference this plan
- [ ] No unnecessary scope additions

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `expo-sqlite` unavailable in the pinned Expo Go | Low | High | Task A0 gates everything; fall back to Option 1A |
| Hydration fights `session_state` over `shots` | **Medium** | Medium | Task A5 gotcha — separate live list from history read path |
| Scope creep across 5 phases on a volunteer team | **High** | High | Each phase independently shippable; maintainers may stop anywhere |
| A non-maintainer proposing a large roadmap change | Medium | Medium | Framed as an extension of locked decisions; options put the call with maintainers |
| SQLite write latency on Pi-adjacent hardware | Low | Low | Fire-and-forget writes; repository never throws |
| Storage growth unbounded | Low | Medium | Add a retention setting in Phase D |

---

## Notes

- **Open PR #1 findings interact with this plan.** The review on PR #1 flagged that
  `disconnect()` never calls `clearShots`, so reconnecting to a different server shows
  stale shots. Phase A makes that worse (persisted stale data), so **fix that finding
  before or during Task A3.** Also relevant: `CurrentShotView.tsx:35` dereferences
  `carry_range[0]` unguarded — Phase B's dispersion work reads the same field, so the
  guard should land once and be reused.
- **`ROADMAP.md` currently exists only on the `pr-1` branch**, not on `main`. This plan
  assumes that PR merges; if it doesn't, the "extends the roadmap" framing needs revisiting.
- **Political framing matters.** This is a proposal from outside the maintainer group. It
  is deliberately written as an extension of `ROADMAP.md`, preserves every locked
  decision, and puts five genuine forks to the maintainers rather than assuming answers.
- Fact / inference / recommendation are separated: competitor behaviour is fact from
  first-party App Store listings; "the phone app is the memory layer" is inference; the
  phase ordering is a judgement call and should be argued with.
