import { create } from 'zustand';
import type {
  DebugStatusPayload,
  DebugToggledPayload,
  PowerStatusPayload,
  TriggerStatusPayload,
} from '../types';

// A mirror of the hardware the connected server is driving, not a source of
// truth. The server pushes `trigger_status` and `power_status` on connect and
// again whenever they change, so each payload is a complete snapshot and there
// is nothing to reconcile.
//
// Deliberately not persisted. On a headless Pi this panel is the only window
// onto the radar and the battery, and a remembered reading is indistinguishable
// on screen from a live one -- so a stale battery percentage from yesterday
// would be worse than an honest blank. Kept out of useSessionStore, which its
// own header describes as deliberately small and framework-agnostic.

interface DeviceState {
  triggerStatus: TriggerStatusPayload | null;
  powerStatus: PowerStatusPayload | null;
  // False until the first snapshot of each kind lands, so a screen can tell
  // "not asked yet" apart from "asked, and there is no such hardware" and show
  // a skeleton instead of claiming the radar or battery is absent.
  triggerLoaded: boolean;
  powerLoaded: boolean;

  // Debug recording: whether the Pi is writing a diagnostic log, and where it
  // landed. The path is the only way to find the file on a headless box.
  //
  // debugEnabled starts false, which on screen is indistinguishable from a Pi
  // that answered "not recording". Debug mode is server-global, so a session
  // may already be recording when this phone connects -- debugLoaded is what
  // lets a screen wait rather than offer a Start that would actually stop it.
  debugEnabled: boolean;
  debugLogPath: string | null;
  debugLoaded: boolean;

  applyTriggerStatus: (status: TriggerStatusPayload) => void;
  applyPowerStatus: (status: PowerStatusPayload) => void;
  applyDebugStatus: (status: DebugStatusPayload | DebugToggledPayload) => void;
  // Drop back to the pre-connection state. Status belongs to the server that
  // reported it; another Pi's radar port must not linger as though it were
  // this one's.
  reset: () => void;
}

export const useDeviceStore = create<DeviceState>((set) => ({
  triggerStatus: null,
  powerStatus: null,
  triggerLoaded: false,
  powerLoaded: false,
  debugEnabled: false,
  debugLogPath: null,
  debugLoaded: false,

  // Both appliers replace wholesale rather than merging: a snapshot is the
  // whole truth, and merging would strand a field from an older reading beside
  // fresh ones. A malformed payload leaves the last good reading in place --
  // blanking the panel mid-session reads as "the hardware went away", which is
  // a worse lie than a reading a few seconds stale.
  applyTriggerStatus: (status) => {
    if (!status || typeof status !== 'object') return;
    set({ triggerStatus: status, triggerLoaded: true });
  },

  applyPowerStatus: (status) => {
    if (!status || typeof status !== 'object') return;
    set({ powerStatus: status, powerLoaded: true });
  },

  // `debug_status` carries log_path explicitly; `debug_toggled` omits the key
  // entirely when disabling. Reading an absent key as null rather than leaving
  // the previous value keeps a finished log from looking like a live one.
  applyDebugStatus: (status) => {
    if (!status || typeof status !== 'object') return;
    set({
      debugEnabled: Boolean(status.enabled),
      debugLogPath: status.log_path ?? null,
      debugLoaded: true,
    });
  },

  reset: () =>
    set({
      triggerStatus: null,
      powerStatus: null,
      triggerLoaded: false,
      powerLoaded: false,
      debugEnabled: false,
      debugLogPath: null,
      debugLoaded: false,
    }),
}));
