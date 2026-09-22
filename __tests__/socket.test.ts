import { socketService } from '../services/socket';
import { useDeviceStore } from '../stores/useDeviceStore';
import { useSessionStore } from '../stores/useSessionStore';
import type { Shot } from '../types';

// Fake Socket.IO socket. The fake is built *inside* the mock factory (not
// captured from an outer const) so it exists by the time `services/socket`
// requires 'socket.io-client' during import — outer consts would still be in
// their temporal dead zone at that point. The internals are exposed on `__mock`
// and pulled back out with requireMock below.
jest.mock('socket.io-client', () => {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const emit = jest.fn();
  const close = jest.fn();
  // Mirrors Socket.IO's `socket.connected`; `trigger` flips it alongside the
  // connect/disconnect events it fires.
  const status = { connected: false };
  const io = jest.fn((_url: string, _opts?: unknown) => ({
    on: (event: string, cb: (...args: unknown[]) => void) => {
      handlers[event] = cb;
    },
    emit,
    close,
    get connected() {
      return status.connected;
    },
  }));
  return { io, __mock: { handlers, emit, close, status } };
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Stand-in for the on-device history. Built inside the factory for the same
// temporal-dead-zone reason as the socket fake above; the repository itself is
// covered against a real database in shotRepository.test.ts.
jest.mock('../storage/db', () => {
  const saveShot = jest.fn(() => Promise.resolve());
  return {
    getShotRepository: jest.fn(() => Promise.resolve({ saveShot })),
    __mock: { saveShot },
  };
});

const dbMock = jest.requireMock('../storage/db') as {
  getShotRepository: jest.Mock;
  __mock: { saveShot: jest.Mock };
};
const { saveShot: mockSaveShot } = dbMock.__mock;

// Persistence is deliberately fire-and-forget, so the write lands a microtask
// after the event; flush before asserting on it.
const flushPendingWrites = () => new Promise<void>((resolve) => setImmediate(() => resolve()));

const socketMock = jest.requireMock('socket.io-client') as {
  io: jest.Mock;
  __mock: {
    handlers: Record<string, (...args: unknown[]) => void>;
    emit: jest.Mock;
    close: jest.Mock;
    status: { connected: boolean };
  };
};
const { io: mockIo } = socketMock;
const {
  emit: mockEmit,
  close: mockClose,
  handlers: mockHandlers,
  status: mockStatus,
} = socketMock.__mock;

function trigger(event: string, ...args: unknown[]) {
  if (event === 'connect') mockStatus.connected = true;
  if (event === 'disconnect' || event === 'connect_error') mockStatus.connected = false;
  mockHandlers[event]?.(...args);
}

function makeShot(timestamp: string, overrides: Partial<Shot> = {}): Shot {
  return {
    shot_number: 1,
    ball_speed_mph: 100,
    club_speed_mph: null,
    smash_factor: null,
    estimated_carry_yards: 250,
    carry_spin_adjusted: null,
    carry_range: [240, 260],
    club: 'driver',
    profile_id: null,
    profile_name: null,
    timestamp,
    launch_angle_vertical: null,
    launch_angle_horizontal: null,
    launch_angle_confidence: null,
    angle_source: null,
    club_angle_deg: null,
    club_path_deg: null,
    spin_axis_deg: null,
    spin_rpm: null,
    spin_source: null,
    spin_quality: null,
    ...overrides,
  };
}

beforeEach(() => {
  useSessionStore.setState({
    connectionState: 'disconnected',
    sessionId: null,
    shots: [],
    club: null,
  });
  useDeviceStore.getState().reset();
  for (const key of Object.keys(mockHandlers)) delete mockHandlers[key];
  mockStatus.connected = false;
  mockIo.mockClear();
  mockEmit.mockClear();
  mockClose.mockClear();
  mockSaveShot.mockClear();
  mockSaveShot.mockResolvedValue(undefined);
});

afterEach(() => {
  socketService.disconnect();
});

describe('socketService', () => {
  it('opens a connection and reports connecting', () => {
    socketService.connect('http://host:8080');
    expect(mockIo).toHaveBeenCalledTimes(1);
    expect(mockIo).toHaveBeenCalledWith(
      'http://host:8080',
      expect.objectContaining({ reconnection: true }),
    );
    expect(useSessionStore.getState().connectionState).toBe('connecting');
  });

  it('ignores a repeated connect to the same address while connecting', () => {
    socketService.connect('http://host:8080');
    socketService.connect('http://host:8080');
    expect(mockIo).toHaveBeenCalledTimes(1);
  });

  it('ignores a repeated connect to the same address while connected', () => {
    socketService.connect('http://host:8080');
    trigger('connect');
    socketService.connect('http://host:8080');
    expect(mockIo).toHaveBeenCalledTimes(1);
  });

  it('replaces an in-flight attempt when the address changes', () => {
    // Regression: the guard keyed only on connection state, so a mistyped
    // address could not be corrected. Tapping Connect again was swallowed and
    // the field stayed editable but inert until Socket.IO's 20s default timeout
    // elapsed, with no feedback that the tap had done nothing.
    socketService.connect('http://typo:8080');
    socketService.connect('http://host:8080');

    expect(mockIo).toHaveBeenCalledTimes(2);
    expect(mockIo).toHaveBeenLastCalledWith('http://host:8080', expect.any(Object));
    expect(mockClose).toHaveBeenCalledTimes(1); // the abandoned attempt is torn down
    expect(useSessionStore.getState().connectionState).toBe('connecting');
  });

  it('reconnects to an address that was previously disconnected from', () => {
    socketService.connect('http://host:8080');
    trigger('connect');
    socketService.disconnect();
    socketService.connect('http://host:8080');
    expect(mockIo).toHaveBeenCalledTimes(2);
    expect(useSessionStore.getState().connectionState).toBe('connecting');
  });

  it('on connect: reports connected and requests the session', () => {
    socketService.connect('http://host:8080');
    trigger('connect');
    expect(useSessionStore.getState().connectionState).toBe('connected');
    expect(mockEmit).toHaveBeenCalledWith('get_session');
  });

  it('session_state replaces shots newest-first', () => {
    socketService.connect('http://host:8080');
    trigger('session_state', { shots: [makeShot('t1'), makeShot('t2')] });
    const shots = useSessionStore.getState().shots;
    expect(shots[0].timestamp).toBe('t2');
  });

  it('shot event prepends the new shot', () => {
    socketService.connect('http://host:8080');
    trigger('session_state', { shots: [makeShot('t1')] });
    trigger('shot', { shot: makeShot('t2', { shot_number: 2 }) });
    const shots = useSessionStore.getState().shots;
    expect(shots).toHaveLength(2);
    expect(shots[0].timestamp).toBe('t2');
  });

  it('disconnect event reports disconnected', () => {
    socketService.connect('http://host:8080');
    trigger('connect');
    trigger('disconnect');
    expect(useSessionStore.getState().connectionState).toBe('disconnected');
  });

  it('connect_error reports error', () => {
    socketService.connect('http://host:8080');
    trigger('connect_error');
    expect(useSessionStore.getState().connectionState).toBe('error');
  });

  it('allows a retry after a failed connection', () => {
    // Regression: after a failed connect, Socket.IO leaves the socket assigned,
    // so a second connect() was swallowed by the "already connecting" guard and
    // the only recovery was reloading the whole app.
    socketService.connect('http://host:8080');
    trigger('connect_error');
    expect(useSessionStore.getState().connectionState).toBe('error');

    socketService.connect('http://host:8080');
    expect(mockIo).toHaveBeenCalledTimes(2); // a fresh attempt, not swallowed
    expect(mockClose).toHaveBeenCalledTimes(1); // the failed socket is torn down
    expect(useSessionStore.getState().connectionState).toBe('connecting');
  });

  it('starts a session once the connection is established', () => {
    // Shots are filed under a session, so one has to exist before any arrive.
    socketService.connect('http://host:8080');
    expect(useSessionStore.getState().sessionId).toBeNull();

    trigger('connect');

    expect(useSessionStore.getState().sessionId).toEqual(expect.any(String));
  });

  it('writes each arriving shot into history under the current session', async () => {
    socketService.connect('http://host:8080');
    trigger('connect');
    const shot = makeShot('t1');

    trigger('shot', { shot });
    await flushPendingWrites();

    expect(mockSaveShot).toHaveBeenCalledTimes(1);
    expect(mockSaveShot).toHaveBeenCalledWith(useSessionStore.getState().sessionId, shot);
  });

  it('files the shot with the player the server attributed it to', async () => {
    // Two people sharing a bay produce one session; without the profile the
    // stored history cannot tell their shots apart.
    socketService.connect('http://host:8080');
    trigger('connect');

    trigger('shot', { shot: makeShot('t1', { profile_id: 'p1', profile_name: 'Alex' }) });
    await flushPendingWrites();

    expect(mockSaveShot).toHaveBeenCalledWith(
      useSessionStore.getState().sessionId,
      expect.objectContaining({ profile_id: 'p1', profile_name: 'Alex' }),
    );
  });

  it('still shows the shot when writing it to history fails', async () => {
    // A storage fault must cost history, never the shot the player just hit.
    mockSaveShot.mockRejectedValueOnce(new Error('disk full'));
    socketService.connect('http://host:8080');
    trigger('connect');

    trigger('shot', { shot: makeShot('t1') });
    await flushPendingWrites();

    expect(useSessionStore.getState().shots).toHaveLength(1);
  });

  it('simulateShot emits the simulate_shot event', () => {
    socketService.connect('http://host:8080');
    mockEmit.mockClear();
    socketService.simulateShot();
    expect(mockEmit).toHaveBeenCalledWith('simulate_shot');
  });

  it('disconnect() closes the socket and reports disconnected', () => {
    socketService.connect('http://host:8080');
    socketService.disconnect();
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().connectionState).toBe('disconnected');
  });
});

describe('a shot the server enriches after publishing it', () => {
  it('shows one shot, with the final measurements, across the whole sequence', async () => {
    // The server publishes provisional OPS metrics as `shot`, then republishes
    // the same shot_number as `shot_update` once the slow hardware reports. The
    // player hit one ball and must see one row.
    socketService.connect('http://host:8080');
    trigger('connect');

    trigger('shot', { shot: makeShot('t1', { shot_number: 7, spin_rpm: null }) });
    trigger('shot_update', { shot: makeShot('t1', { shot_number: 7, spin_rpm: 2680 }) });
    await flushPendingWrites();

    const shots = useSessionStore.getState().shots;
    expect(shots).toHaveLength(1);
    expect(shots[0].spin_rpm).toBe(2680);
  });

  it('files the update against the same shot instead of adding a second one', async () => {
    // Both events go through the same keyed write, so history stores one row —
    // the repository decides insert-or-update from the shot_number it is given.
    socketService.connect('http://host:8080');
    trigger('connect');
    const sessionId = useSessionStore.getState().sessionId;

    trigger('shot', { shot: makeShot('t1', { shot_number: 7, spin_rpm: null }) });
    trigger('shot_update', { shot: makeShot('t1', { shot_number: 7, spin_rpm: 2680 }) });
    await flushPendingWrites();

    expect(mockSaveShot).toHaveBeenCalledTimes(2);
    for (const call of mockSaveShot.mock.calls) {
      expect(call[0]).toBe(sessionId);
      expect((call[1] as Shot).shot_number).toBe(7);
    }
    expect((mockSaveShot.mock.calls[1][1] as Shot).spin_rpm).toBe(2680);
  });

  it('handles the skipped-enrichment update, which carries the shot unchanged', async () => {
    // When the optional hardware cannot be admitted the server clears the
    // pending state by republishing the same shot immediately.
    socketService.connect('http://host:8080');
    trigger('connect');

    trigger('shot', { shot: makeShot('t1', { shot_number: 7 }) });
    trigger('shot_update', { shot: makeShot('t1', { shot_number: 7 }) });
    await flushPendingWrites();

    expect(useSessionStore.getState().shots).toHaveLength(1);
  });

  it('keeps an update for a shot that arrived before this phone connected', async () => {
    // Connecting mid-flight can deliver the update without its provisional
    // shot; dropping it would lose the swing entirely.
    socketService.connect('http://host:8080');
    trigger('connect');

    trigger('shot_update', { shot: makeShot('t1', { shot_number: 7 }) });
    await flushPendingWrites();

    expect(useSessionStore.getState().shots).toHaveLength(1);
    expect(mockSaveShot).toHaveBeenCalledTimes(1);
  });

  it('still shows the enriched shot when writing the update fails', async () => {
    mockSaveShot.mockRejectedValueOnce(new Error('disk full'));
    socketService.connect('http://host:8080');
    trigger('connect');

    trigger('shot_update', { shot: makeShot('t1', { shot_number: 7, spin_rpm: 2680 }) });
    await flushPendingWrites();

    expect(useSessionStore.getState().shots[0].spin_rpm).toBe(2680);
  });
});

// On a headless Pi this panel is the only window onto the radar and the
// battery, so what it shows has to follow the connection honestly: present
// while a server is answering, gone once it is not.
describe('device status', () => {
  const triggerStatus = {
    mode: 'rolling-buffer',
    trigger_type: 'audio',
    radar_connected: true,
    radar_port: '/dev/ttyUSB0',
    triggers_total: 12,
    triggers_accepted: 9,
    triggers_rejected: 3,
  };

  const powerStatus = {
    available: true,
    provider: 'geekworm',
    state: 'on_battery',
    battery_percent: 78,
    battery_voltage_v: 3.91,
    external_power: false,
    updated_at: '2026-09-22T05:30:00Z',
    error: null,
  };

  it('asks for the trigger status once connected', () => {
    // The server pushes it on connect, but a phone joining an already-running
    // session cannot rely on having seen that push, so it asks as well.
    socketService.connect('http://host:8080');
    trigger('connect');

    expect(mockEmit).toHaveBeenCalledWith('get_trigger_status');
  });

  it('asks again after reconnecting, since the hardware may have changed', () => {
    socketService.connect('http://host:8080');
    trigger('connect');
    mockEmit.mockClear();

    trigger('disconnect');
    trigger('connect');

    expect(mockEmit).toHaveBeenCalledWith('get_trigger_status');
  });

  it('shows the trigger status the server reports', () => {
    socketService.connect('http://host:8080');
    trigger('connect');

    trigger('trigger_status', triggerStatus);

    expect(useDeviceStore.getState().triggerStatus?.radar_port).toBe('/dev/ttyUSB0');
    expect(useDeviceStore.getState().triggerLoaded).toBe(true);
  });

  it('shows the power status the server reports', () => {
    socketService.connect('http://host:8080');
    trigger('connect');

    trigger('power_status', powerStatus);

    expect(useDeviceStore.getState().powerStatus?.battery_percent).toBe(78);
    expect(useDeviceStore.getState().powerLoaded).toBe(true);
  });

  it('ignores a malformed status rather than blanking the panel', () => {
    socketService.connect('http://host:8080');
    trigger('connect');
    trigger('trigger_status', triggerStatus);
    trigger('power_status', powerStatus);

    trigger('trigger_status', null);
    trigger('power_status', undefined);

    expect(useDeviceStore.getState().triggerStatus?.mode).toBe('rolling-buffer');
    expect(useDeviceStore.getState().powerStatus?.provider).toBe('geekworm');
  });

  it('keeps the last reading through a transient drop', () => {
    // Socket.IO reconnects on its own. Blanking the radar and battery every
    // time the wifi hiccups would read as hardware failing, not a wobbly link.
    socketService.connect('http://host:8080');
    trigger('connect');
    trigger('trigger_status', triggerStatus);
    trigger('power_status', powerStatus);

    trigger('disconnect');

    expect(useDeviceStore.getState().triggerStatus).not.toBeNull();
    expect(useDeviceStore.getState().powerStatus).not.toBeNull();
  });

  it('forgets the device when the user disconnects deliberately', () => {
    socketService.connect('http://host:8080');
    trigger('connect');
    trigger('trigger_status', triggerStatus);
    trigger('power_status', powerStatus);
    // The panel has to be showing something first, or "it is empty afterwards"
    // is true of a store nothing ever filled and proves nothing.
    expect(useDeviceStore.getState().triggerStatus).not.toBeNull();
    expect(useDeviceStore.getState().powerStatus).not.toBeNull();

    socketService.disconnect();

    const state = useDeviceStore.getState();
    expect(state.triggerStatus).toBeNull();
    expect(state.powerStatus).toBeNull();
    expect(state.triggerLoaded).toBe(false);
    expect(state.powerLoaded).toBe(false);
  });

  it('asks for the debug state once connected', () => {
    socketService.connect('http://host:8080');
    trigger('connect');

    expect(mockEmit).toHaveBeenCalledWith('get_debug_status');
  });

  it('shows the debug recording state the server reports', () => {
    socketService.connect('http://host:8080');
    trigger('connect');

    trigger('debug_status', { enabled: true, log_path: '/home/pi/debug.jsonl' });

    expect(useDeviceStore.getState().debugEnabled).toBe(true);
    expect(useDeviceStore.getState().debugLogPath).toBe('/home/pi/debug.jsonl');
  });

  it('follows a debug toggle made on another client', () => {
    socketService.connect('http://host:8080');
    trigger('connect');

    trigger('debug_toggled', { enabled: true, log_path: '/home/pi/debug.jsonl' });

    expect(useDeviceStore.getState().debugEnabled).toBe(true);
  });

  it('asks the server to toggle debug recording while connected', () => {
    socketService.connect('http://host:8080');
    trigger('connect');
    mockEmit.mockClear();

    socketService.toggleDebug();

    expect(mockEmit).toHaveBeenCalledWith('toggle_debug');
  });

  it('sends no toggle during a transient drop, even once reconnected', () => {
    // Socket.IO buffers anything emitted through a drop and replays it on
    // reconnect, so a toggle tapped while the wifi was away would land later
    // and flip recording behind the user's back.
    socketService.connect('http://host:8080');
    trigger('connect');
    trigger('disconnect');
    mockEmit.mockClear();

    socketService.toggleDebug();
    trigger('connect');

    expect(mockEmit).not.toHaveBeenCalledWith('toggle_debug');
  });

  it('forgets the debug state on a deliberate disconnect', () => {
    socketService.connect('http://host:8080');
    trigger('connect');
    trigger('debug_status', { enabled: true, log_path: '/home/pi/debug.jsonl' });
    expect(useDeviceStore.getState().debugEnabled).toBe(true);

    socketService.disconnect();

    expect(useDeviceStore.getState().debugEnabled).toBe(false);
    expect(useDeviceStore.getState().debugLogPath).toBeNull();
  });

  it('forgets the device when switching to a different server', () => {
    // Another Pi's radar port and battery must not be read as this one's.
    socketService.connect('http://host:8080');
    trigger('connect');
    trigger('trigger_status', triggerStatus);
    trigger('power_status', powerStatus);
    expect(useDeviceStore.getState().triggerStatus).not.toBeNull();
    expect(useDeviceStore.getState().powerStatus).not.toBeNull();

    socketService.connect('http://other:8080');

    expect(useDeviceStore.getState().triggerStatus).toBeNull();
    expect(useDeviceStore.getState().powerStatus).toBeNull();
  });
});

describe('the selected club', () => {
  it('takes the club the server restores on connect', () => {
    socketService.connect('http://host:8080');
    trigger('connect');

    trigger('session_state', { shots: [], club: '7-iron' });

    expect(useSessionStore.getState().club).toBe('7-iron');
  });

  it('keeps the club when a session snapshot does not carry one', () => {
    // An older server's session_state has no club key; that is not a reset.
    socketService.connect('http://host:8080');
    trigger('connect');
    trigger('session_state', { shots: [], club: '7-iron' });

    trigger('session_state', { shots: [] });

    expect(useSessionStore.getState().club).toBe('7-iron');
  });

  it('follows a change made on another client', () => {
    socketService.connect('http://host:8080');
    trigger('connect');

    trigger('club_changed', { club: 'pw' });

    expect(useSessionStore.getState().club).toBe('pw');
  });

  it('ignores a malformed club change', () => {
    socketService.connect('http://host:8080');
    trigger('connect');
    trigger('club_changed', { club: 'pw' });

    trigger('club_changed', {});
    trigger('club_changed', { club: 7 });
    trigger('club_changed', null);

    expect(useSessionStore.getState().club).toBe('pw');
  });

  it('asks the server to change club while connected', () => {
    socketService.connect('http://host:8080');
    trigger('connect');

    socketService.setClub('5-wood');

    expect(mockEmit).toHaveBeenCalledWith('set_club', { club: '5-wood' });
  });

  it('waits for the server to confirm before showing the new club', () => {
    // The server ignores a club it does not recognise without replying, so a
    // local change would show a club that shots are not filed under.
    socketService.connect('http://host:8080');
    trigger('connect');
    trigger('session_state', { shots: [], club: 'driver' });

    socketService.setClub('5-wood');

    expect(useSessionStore.getState().club).toBe('driver');
  });

  it('sends nothing before a connection is established', () => {
    socketService.connect('http://host:8080');

    socketService.setClub('5-wood');

    expect(mockEmit).not.toHaveBeenCalledWith('set_club', expect.anything());
  });

  it('sends nothing during a transient drop, even once reconnected', () => {
    // Socket.IO keeps the socket through a wifi drop and would buffer the emit
    // for replay on reconnect, filing later shots under a club picked earlier.
    socketService.connect('http://host:8080');
    trigger('connect');
    trigger('disconnect');

    socketService.setClub('5-wood');
    trigger('connect');

    expect(mockEmit).not.toHaveBeenCalledWith('set_club', expect.anything());
  });

  it('keeps the club through a transient drop', () => {
    socketService.connect('http://host:8080');
    trigger('connect');
    trigger('club_changed', { club: 'pw' });

    trigger('disconnect');

    expect(useSessionStore.getState().club).toBe('pw');
  });

  it('forgets the club when the user disconnects deliberately', () => {
    socketService.connect('http://host:8080');
    trigger('connect');
    trigger('club_changed', { club: 'pw' });

    socketService.disconnect();

    expect(useSessionStore.getState().club).toBeNull();
  });

  it('forgets the club when switching to a different server', () => {
    socketService.connect('http://host:8080');
    trigger('connect');
    trigger('club_changed', { club: 'pw' });

    socketService.connect('http://other:8080');

    expect(useSessionStore.getState().club).toBeNull();
  });
});
