import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import DeviceScreen from '../app/(tabs)/device';
import { requestShutdown } from '../services/shutdown';
import { socketService } from '../services/socket';
import { useDeviceStore } from '../stores/useDeviceStore';
import { useSessionStore } from '../stores/useSessionStore';
import type { ConnectionState, PowerStatusPayload, TriggerStatusPayload } from '../types';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// The HTTP call itself is covered against a stubbed fetch in shutdown.test.ts;
// here only the screen's use of it matters.
jest.mock('../services/shutdown', () => ({
  requestShutdown: jest.fn(() => Promise.resolve()),
}));

const mockRequestShutdown = requestShutdown as jest.MockedFunction<typeof requestShutdown>;

// The socket service is exercised directly in socket.test.ts; here only the
// screen's use of it matters.
jest.mock('../services/socket', () => ({
  socketService: {
    toggleDebug: jest.fn(),
  },
}));

const mockedSocket = socketService as jest.Mocked<typeof socketService>;

function makeTriggerStatus(overrides: Partial<TriggerStatusPayload> = {}): TriggerStatusPayload {
  return {
    mode: 'rolling-buffer',
    trigger_type: 'audio',
    radar_connected: true,
    radar_port: '/dev/ttyUSB0',
    triggers_total: 12,
    triggers_accepted: 9,
    triggers_rejected: 3,
    ...overrides,
  };
}

function makePowerStatus(overrides: Partial<PowerStatusPayload> = {}): PowerStatusPayload {
  return {
    available: true,
    provider: 'geekworm',
    state: 'on_battery',
    battery_percent: 78,
    battery_voltage_v: 3.91,
    external_power: false,
    updated_at: '2026-09-22T05:30:00Z',
    error: null,
    ...overrides,
  };
}

// render() and fireEvent are asynchronous in React Native Testing Library 14;
// every call is awaited so state is committed before the next assertion.
async function renderDevice(
  connectionState: ConnectionState,
  device: {
    triggerStatus?: TriggerStatusPayload | null;
    powerStatus?: PowerStatusPayload | null;
    debug?: { enabled: boolean; logPath?: string };
  } = {},
) {
  // A session is one connection span; the socket service starts a new one on
  // every connect, and the shutdown panel keys off it.
  useSessionStore.setState({ connectionState, sessionId: 'session-1' });
  useDeviceStore.getState().reset();
  if (device.triggerStatus) useDeviceStore.getState().applyTriggerStatus(device.triggerStatus);
  if (device.powerStatus) useDeviceStore.getState().applyPowerStatus(device.powerStatus);
  if (device.debug) {
    useDeviceStore
      .getState()
      .applyDebugStatus({ enabled: device.debug.enabled, log_path: device.debug.logPath ?? null });
  }
  await render(<DeviceScreen />);
}

const SHUT_DOWN = 'Shut down';
const CONFIRM = 'Shut down the Pi';

beforeEach(() => {
  jest.clearAllMocks();
  mockRequestShutdown.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('device status', () => {
  it('reports the radar the server says it is driving', async () => {
    await renderDevice('connected', { triggerStatus: makeTriggerStatus() });

    expect(screen.getByText('/dev/ttyUSB0')).toBeTruthy();
    expect(screen.getByText('audio')).toBeTruthy();
  });

  it('counts the triggers the server has accepted and rejected', async () => {
    // With no screen on the Pi, these counters are the only way to tell a
    // radar that sees nothing from one rejecting everything it sees.
    await renderDevice('connected', {
      triggerStatus: makeTriggerStatus({
        triggers_total: 40,
        triggers_accepted: 31,
        triggers_rejected: 9,
      }),
    });

    expect(screen.getByText('31')).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
  });

  it('does not call a working mock setup a disconnected radar', async () => {
    // The server reports radar_connected as `monitor is not None and not
    // mock_mode`, so mock mode reads false while everything works. Saying
    // "radar offline" there would send someone hunting a fault that is not
    // there.
    await renderDevice('connected', {
      triggerStatus: makeTriggerStatus({
        mode: 'mock',
        radar_connected: false,
        radar_port: null,
        trigger_type: null,
      }),
    });

    expect(screen.getByText(/mock/i)).toBeTruthy();
    expect(screen.queryByText(/offline/i)).toBeNull();
  });

  it('shows the battery the Pi is running on', async () => {
    await renderDevice('connected', { powerStatus: makePowerStatus({ battery_percent: 78 }) });

    expect(screen.getByText('78%')).toBeTruthy();
  });

  it('says a Pi on mains has no battery rather than showing an empty one', async () => {
    // available:false is an answer. Rendering it as 0% would look like a Pi
    // about to die.
    await renderDevice('connected', {
      powerStatus: makePowerStatus({
        available: false,
        state: 'unavailable',
        battery_percent: null,
        battery_voltage_v: null,
        external_power: null,
      }),
    });

    expect(screen.queryByText('0%')).toBeNull();
    expect(screen.getByText(/no battery|not available/i)).toBeTruthy();
  });

  it('waits rather than claiming the hardware is missing before the server answers', async () => {
    // Nothing has been reported yet; an empty state here would read as "this
    // Pi has no radar", which is a different and wrong claim.
    await renderDevice('connected');

    expect(screen.queryByText(/no radar/i)).toBeNull();
    expect(screen.getByText(/waiting for the server/i)).toBeTruthy();
  });

  it('asks for a connection before it can report anything', async () => {
    await renderDevice('disconnected');

    expect(screen.getByText(/connect to a server/i)).toBeTruthy();
  });
});

describe('device controls', () => {
  it('offers to start a diagnostic recording', async () => {
    await renderDevice('connected', {
      triggerStatus: makeTriggerStatus(),
      debug: { enabled: false },
    });

    await fireEvent.press(screen.getByLabelText('Start debug recording'));

    expect(mockedSocket.toggleDebug).toHaveBeenCalledTimes(1);
  });

  it('says where the log is being written once recording', async () => {
    // On a headless Pi the path is the only way to find the file afterwards.
    await renderDevice('connected', {
      triggerStatus: makeTriggerStatus(),
      debug: { enabled: true, logPath: '/home/pi/openflight_sessions/debug.jsonl' },
    });

    expect(screen.getByText('/home/pi/openflight_sessions/debug.jsonl')).toBeTruthy();
    expect(screen.getByLabelText('Stop debug recording')).toBeTruthy();
  });

  it('waits for the server to confirm a recording change', async () => {
    // The server broadcasts the new state; showing it locally first would lie
    // about whether anything is actually being written to disk.
    await renderDevice('connected', {
      triggerStatus: makeTriggerStatus(),
      debug: { enabled: false },
    });

    await fireEvent.press(screen.getByLabelText('Start debug recording'));

    expect(screen.getByLabelText('Start debug recording')).toBeTruthy();
  });

  // The pair below is deliberately two tests rather than one that renders,
  // cleans up and renders again: a cleanup() inside a test body leaves
  // RNTL's container state inconsistent for whichever test runs next, which
  // made every later test in this file fail while each passed on its own.
  it('offers the controls while a Pi is answering', async () => {
    await renderDevice('connected', {
      triggerStatus: makeTriggerStatus(),
      debug: { enabled: false },
    });

    expect(screen.getByLabelText('Start debug recording')).toBeTruthy();
  });

  it('waits for the Pi to say whether it is already recording', async () => {
    // Debug mode is a server-global flag, so a session can already be
    // recording when this phone connects. Showing the default "Start" before
    // the answer arrives means a tap would STOP an active capture while the
    // label said start -- so the control waits, like every other card here.
    await renderDevice('connected', { triggerStatus: makeTriggerStatus() });

    expect(screen.queryByLabelText('Start debug recording')).toBeNull();
    expect(screen.queryByLabelText('Stop debug recording')).toBeNull();
  });

  it('offers to stop a recording that was already running when it connected', async () => {
    await renderDevice('connected', {
      triggerStatus: makeTriggerStatus(),
      debug: { enabled: true, logPath: '/home/pi/openflight_sessions/debug.jsonl' },
    });

    expect(screen.getByLabelText('Stop debug recording')).toBeTruthy();
  });

  it('offers no controls with no server to send them to', async () => {
    // A tap that cannot reach the Pi must not look as though it did. Paired
    // with the test above, which proves the controls exist at all.
    await renderDevice('disconnected');

    expect(screen.queryByLabelText('Start debug recording')).toBeNull();
  });
});

describe('shutting the Pi down', () => {
  it('never shuts down on a single tap', async () => {
    // The whole point of this screen is to stop someone killing a live SD
    // card, so the destructive action is always two deliberate steps.
    await renderDevice('connected', { triggerStatus: makeTriggerStatus() });

    await fireEvent.press(screen.getByText(SHUT_DOWN));

    expect(mockRequestShutdown).not.toHaveBeenCalled();
    expect(screen.getByText(CONFIRM)).toBeTruthy();
  });

  it('shuts down once confirmed', async () => {
    await renderDevice('connected', { triggerStatus: makeTriggerStatus() });
    await fireEvent.press(screen.getByText(SHUT_DOWN));

    await fireEvent.press(screen.getByLabelText('Confirm shutdown'));

    expect(mockRequestShutdown).toHaveBeenCalledTimes(1);
  });

  it('backs out without touching the Pi', async () => {
    await renderDevice('connected', { triggerStatus: makeTriggerStatus() });
    await fireEvent.press(screen.getByText(SHUT_DOWN));

    await fireEvent.press(screen.getByLabelText('Cancel shutdown'));

    expect(mockRequestShutdown).not.toHaveBeenCalled();
    expect(screen.queryByText(CONFIRM)).toBeNull();
  });

  it('says the Pi is stopping once the request is accepted', async () => {
    // The server answers 200 and only then halts, so this reports an accepted
    // request -- not a Pi that has finished stopping.
    await renderDevice('connected', { triggerStatus: makeTriggerStatus() });
    await fireEvent.press(screen.getByText(SHUT_DOWN));

    await fireEvent.press(screen.getByLabelText('Confirm shutdown'));

    await waitFor(() => expect(screen.getByText(/shutting down/i)).toBeTruthy());
  });

  it('says so when the Pi refuses, instead of implying it stopped', async () => {
    // Reporting success here would invite someone to pull the power on a Pi
    // that is still writing to its SD card.
    mockRequestShutdown.mockRejectedValueOnce(new Error('Shutdown request failed (500)'));
    await renderDevice('connected', { triggerStatus: makeTriggerStatus() });
    await fireEvent.press(screen.getByText(SHUT_DOWN));

    await fireEvent.press(screen.getByLabelText('Confirm shutdown'));

    await waitFor(() => expect(screen.getByText(/could not shut down/i)).toBeTruthy());
  });

  it('offers a retry after a failure', async () => {
    mockRequestShutdown.mockRejectedValueOnce(new Error('Network request failed'));
    await renderDevice('connected', { triggerStatus: makeTriggerStatus() });
    await fireEvent.press(screen.getByText(SHUT_DOWN));
    await fireEvent.press(screen.getByLabelText('Confirm shutdown'));
    await waitFor(() => expect(screen.getByText(/could not shut down/i)).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Retry shutdown'));

    expect(mockRequestShutdown).toHaveBeenCalledTimes(2);
  });

  it('cannot be asked for twice while one request is in flight', async () => {
    // A second POST while the first is still open would be a second shutdown
    // request against a Pi already on its way down.
    //
    // The guard is that confirming replaces the button with the in-flight
    // state, so there is nothing left to press. Asserting it by pressing
    // "Confirm shutdown" a second time cannot work: correct behaviour is
    // precisely that the control is gone. What is observable is that the
    // confirm is no longer offered while the request is open, and that only
    // one request was ever sent.
    let release: () => void = () => {};
    mockRequestShutdown.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve();
        }),
    );
    await renderDevice('connected', { triggerStatus: makeTriggerStatus() });
    await fireEvent.press(screen.getByText(SHUT_DOWN));

    await fireEvent.press(screen.getByLabelText('Confirm shutdown'));

    expect(screen.queryByLabelText('Confirm shutdown')).toBeNull();
    expect(screen.getByText(/shutting down/i)).toBeTruthy();
    expect(mockRequestShutdown).toHaveBeenCalledTimes(1);

    // Let the request settle so the pending promise does not outlive the test.
    await act(async () => {
      release();
    });
  });

  it('keeps telling the user not to pull power after the Pi drops the socket', async () => {
    // Regression: the server answers /api/shutdown and only then halts, so the
    // socket drops a moment after success. The screen gated everything on the
    // connection, so the "wait for its lights to settle" line -- the one
    // instruction that prevents a corrupted SD card -- was unmounted before it
    // could be read, leaving the generic "not connected" message instead.
    await renderDevice('connected', { triggerStatus: makeTriggerStatus() });
    await fireEvent.press(screen.getByText(SHUT_DOWN));
    await fireEvent.press(screen.getByLabelText('Confirm shutdown'));
    await waitFor(() => expect(screen.getByText(/shutting down/i)).toBeTruthy());

    // The Pi goes down, exactly as a successful shutdown requires.
    await act(async () => {
      useSessionStore.setState({ connectionState: 'disconnected' });
    });

    expect(screen.getByText(/shutting down/i)).toBeTruthy();
    expect(screen.getByText(/before cutting power/i)).toBeTruthy();
  });

  it('keeps the in-flight state when the connection drops mid-request', async () => {
    // A transient drop while the POST is open must not silently reset to idle:
    // that hides an outstanding shutdown and invites a second one.
    let release: () => void = () => {};
    mockRequestShutdown.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve();
        }),
    );
    await renderDevice('connected', { triggerStatus: makeTriggerStatus() });
    await fireEvent.press(screen.getByText(SHUT_DOWN));
    await fireEvent.press(screen.getByLabelText('Confirm shutdown'));

    await act(async () => {
      useSessionStore.setState({ connectionState: 'disconnected' });
    });

    expect(screen.getByText(/shutting down/i)).toBeTruthy();
    expect(screen.queryByText(SHUT_DOWN)).toBeNull();

    await act(async () => {
      release();
    });
  });

  it('still reports a failure after the connection drops', async () => {
    // A refused shutdown leaves the Pi running. If the socket also drops, the
    // warning must survive -- this is the case where pulling power is worst.
    mockRequestShutdown.mockRejectedValueOnce(new Error('Shutdown request failed (500)'));
    await renderDevice('connected', { triggerStatus: makeTriggerStatus() });
    await fireEvent.press(screen.getByText(SHUT_DOWN));
    await fireEvent.press(screen.getByLabelText('Confirm shutdown'));
    await waitFor(() => expect(screen.getByText(/could not shut down/i)).toBeTruthy());

    await act(async () => {
      useSessionStore.setState({ connectionState: 'disconnected' });
    });

    expect(screen.getByText(/could not shut down/i)).toBeTruthy();
  });

  it('survives the connection dropping while nothing is being shut down', async () => {
    // Regression: the early return that hides this section sat above a
    // useCallback, so a plain drop with phase 'idle' -- someone watching
    // status when the wifi hiccups, the most ordinary use of this screen --
    // rendered fewer hooks than the render before it and React threw
    // "Rendered fewer hooks than expected".
    //
    // Every other disconnect test here confirms a shutdown first, which keeps
    // the phase in INITIATED and never reaches the branch that skips the hook.
    await renderDevice('connected', { triggerStatus: makeTriggerStatus() });

    await act(async () => {
      useSessionStore.setState({ connectionState: 'disconnected' });
    });

    expect(screen.getByText('Not connected')).toBeTruthy();
    expect(screen.queryByText(SHUT_DOWN)).toBeNull();
  });

  it('clears a finished shutdown once a Pi is answering again', async () => {
    // Regression: the outcome is kept so it survives the drop a successful
    // shutdown causes -- but once a Pi is answering again, "wait for its
    // lights to settle" sits next to live status proving it is already back.
    await renderDevice('connected', { triggerStatus: makeTriggerStatus() });
    await fireEvent.press(screen.getByText(SHUT_DOWN));
    await fireEvent.press(screen.getByLabelText('Confirm shutdown'));
    await waitFor(() => expect(screen.getByText(/before cutting power/i)).toBeTruthy());
    await act(async () => {
      useSessionStore.setState({ connectionState: 'disconnected' });
    });

    await act(async () => {
      // Reconnecting starts a new session, exactly as services/socket.ts does.
      useSessionStore.setState({ connectionState: 'connected', sessionId: 'session-2' });
    });

    expect(screen.queryByText(/before cutting power/i)).toBeNull();
    expect(screen.getByText(SHUT_DOWN)).toBeTruthy();
  });

  it('never carries a failed shutdown over to the next Pi', async () => {
    // Regression: "Try again" on a stale failure called straight through to
    // requestShutdown, which resolves the address from storage -- the server
    // connected *now*, not the one that failed. That fires a real shutdown at
    // a different Pi with no confirmation step at all.
    mockRequestShutdown.mockRejectedValueOnce(new Error('Shutdown request failed (500)'));
    await renderDevice('connected', { triggerStatus: makeTriggerStatus() });
    await fireEvent.press(screen.getByText(SHUT_DOWN));
    await fireEvent.press(screen.getByLabelText('Confirm shutdown'));
    await waitFor(() => expect(screen.getByText(/could not shut down/i)).toBeTruthy());
    await act(async () => {
      useSessionStore.setState({ connectionState: 'disconnected' });
    });
    mockRequestShutdown.mockClear();

    // A different Pi answers, under a new session.
    await act(async () => {
      useSessionStore.setState({ connectionState: 'connected', sessionId: 'session-2' });
    });

    expect(screen.queryByLabelText('Retry shutdown')).toBeNull();
    expect(mockRequestShutdown).not.toHaveBeenCalled();
  });

  it('is offered while a Pi is answering', async () => {
    // Paired with the test below: without this one, "absent when disconnected"
    // would be true of a screen that never offers a shutdown at all.
    await renderDevice('connected', { triggerStatus: makeTriggerStatus() });

    expect(screen.getByText(SHUT_DOWN)).toBeTruthy();
  });

  it('cannot be started with no server to send it to', async () => {
    await renderDevice('disconnected');

    expect(screen.queryByText(SHUT_DOWN)).toBeNull();
  });
});
