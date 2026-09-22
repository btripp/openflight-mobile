import { useDeviceStore } from '../stores/useDeviceStore';
import type { PowerStatusPayload, TriggerStatusPayload } from '../types';

// Representative payloads, shaped exactly as the server sends them:
// _get_trigger_status() in src/openflight/server.py and PowerStatus.to_dict()
// in src/openflight/power/models.py.
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

beforeEach(() => {
  useDeviceStore.getState().reset();
});

describe('useDeviceStore', () => {
  it('knows nothing about the device until a server reports something', () => {
    const state = useDeviceStore.getState();

    expect(state.triggerStatus).toBeNull();
    expect(state.powerStatus).toBeNull();
    // A screen has to tell "not asked yet" apart from "asked, nothing there",
    // so it can show a skeleton rather than claim the hardware is absent.
    expect(state.triggerLoaded).toBe(false);
    expect(state.powerLoaded).toBe(false);
  });

  it('mirrors the trigger status the server reports', () => {
    useDeviceStore.getState().applyTriggerStatus(makeTriggerStatus({ triggers_accepted: 41 }));

    const state = useDeviceStore.getState();
    expect(state.triggerStatus?.triggers_accepted).toBe(41);
    expect(state.triggerLoaded).toBe(true);
  });

  it('mirrors the power status the server reports', () => {
    useDeviceStore.getState().applyPowerStatus(makePowerStatus({ battery_percent: 12 }));

    const state = useDeviceStore.getState();
    expect(state.powerStatus?.battery_percent).toBe(12);
    expect(state.powerLoaded).toBe(true);
  });

  it('replaces the previous status wholesale rather than merging into it', () => {
    // Each payload is a complete snapshot. Merging would strand a field from an
    // older reading next to fresh ones and misreport the device.
    useDeviceStore.getState().applyTriggerStatus(makeTriggerStatus({ radar_port: '/dev/ttyUSB0' }));

    useDeviceStore.getState().applyTriggerStatus(makeTriggerStatus({ radar_port: null }));

    expect(useDeviceStore.getState().triggerStatus?.radar_port).toBeNull();
  });

  it('keeps the last good reading when a malformed payload arrives', () => {
    // Blanking the panel mid-session would read as "the hardware went away",
    // which is a worse lie than a reading that is a few seconds stale.
    useDeviceStore.getState().applyTriggerStatus(makeTriggerStatus());
    useDeviceStore.getState().applyPowerStatus(makePowerStatus());

    useDeviceStore.getState().applyTriggerStatus(null as unknown as TriggerStatusPayload);
    useDeviceStore.getState().applyPowerStatus(undefined as unknown as PowerStatusPayload);

    expect(useDeviceStore.getState().triggerStatus?.mode).toBe('rolling-buffer');
    expect(useDeviceStore.getState().powerStatus?.provider).toBe('geekworm');
  });

  it('accepts a device with no battery as a real answer, not a missing one', () => {
    // A mains-powered Pi reports available:false. That is information, and the
    // panel must show it rather than sit on a skeleton forever.
    useDeviceStore.getState().applyPowerStatus(
      makePowerStatus({
        available: false,
        state: 'unavailable',
        battery_percent: null,
        battery_voltage_v: null,
        external_power: null,
      }),
    );

    const state = useDeviceStore.getState();
    expect(state.powerLoaded).toBe(true);
    expect(state.powerStatus?.available).toBe(false);
  });

  it('does not claim the Pi is idle before it has said so', () => {
    // debugEnabled starts false, which is indistinguishable on screen from a
    // Pi that answered "not recording". Debug mode is server-global, so a
    // session may already be recording -- the flag is what lets a screen wait
    // instead of offering a Start that would actually stop it.
    expect(useDeviceStore.getState().debugLoaded).toBe(false);

    useDeviceStore.getState().applyDebugStatus({ enabled: false, log_path: null });

    expect(useDeviceStore.getState().debugLoaded).toBe(true);
  });

  it('mirrors whether the Pi is recording a debug log, and where', () => {
    useDeviceStore.getState().applyDebugStatus({ enabled: true, log_path: '/home/pi/debug.jsonl' });

    const state = useDeviceStore.getState();
    expect(state.debugEnabled).toBe(true);
    expect(state.debugLogPath).toBe('/home/pi/debug.jsonl');
  });

  it('treats a toggle-off without a path as no path, not an unchanged one', () => {
    // handle_toggle_debug omits log_path entirely when disabling, so a client
    // that only overwrites present keys would keep showing the old file as
    // though it were still being written.
    useDeviceStore.getState().applyDebugStatus({ enabled: true, log_path: '/home/pi/debug.jsonl' });

    useDeviceStore.getState().applyDebugStatus({ enabled: false });

    expect(useDeviceStore.getState().debugEnabled).toBe(false);
    expect(useDeviceStore.getState().debugLogPath).toBeNull();
  });

  it('forgets a device once it is no longer the one being talked to', () => {
    // Status belongs to the server that reported it; another Pi's radar port
    // and battery must not linger as though they described the new one.
    useDeviceStore.getState().applyTriggerStatus(makeTriggerStatus());
    useDeviceStore.getState().applyPowerStatus(makePowerStatus());

    useDeviceStore.getState().reset();

    const state = useDeviceStore.getState();
    expect(state.triggerStatus).toBeNull();
    expect(state.powerStatus).toBeNull();
    expect(state.triggerLoaded).toBe(false);
    expect(state.powerLoaded).toBe(false);
  });
});
