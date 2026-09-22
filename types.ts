// Local mirror of the subset of src/openflight/server.py's shot_to_dict() payload
// that the mobile UI renders. Intentionally self-contained rather than shared
// with ui/src/types/shot.ts -- the two apps ship separately, and both are just
// hand-mirrors of the Python wire contract (the real source of truth).

export type SpinQuality = 'high' | 'medium' | 'low' | 'experimental';

// Graded confidence used for the 3-dot indicator on launch-angle tiles.
export type AngleQuality = 'high' | 'medium' | 'low';

export interface Shot {
  mode?: 'rolling-buffer' | 'mock' | 'swing-speed';
  // The server's identity for a shot, assigned before any async work and never
  // reassigned. A shot can reach the client twice -- provisionally as `shot`,
  // then again as `shot_update` once enrichment finishes -- and this is what
  // ties the two together.
  shot_number: number | null;
  ball_speed_mph: number;
  club_speed_mph: number | null;
  smash_factor: number | null;
  estimated_carry_yards: number;
  carry_spin_adjusted: number | null;
  carry_range: [number, number];
  club: string;
  // The profile that was active when the shot was struck. Two people sharing a
  // bay produce one session, so this is what keeps their histories apart.
  profile_id: string | null;
  profile_name: string | null;
  timestamp: string;
  // Launch angle data (radar/camera/estimation; "mock" in mock mode)
  launch_angle_vertical: number | null;
  launch_angle_horizontal: number | null;
  launch_angle_confidence: number | null;
  angle_source: string | null;
  club_angle_deg: number | null;
  club_path_deg: number | null;
  spin_axis_deg: number | null;
  // Rolling buffer mode spin data
  spin_rpm: number | null;
  spin_source: 'measured' | 'calculated' | null;
  spin_quality: SpinQuality | null;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

// --- Wire-contract payloads (mirror src/openflight/server.py SocketIO events) ---
// These document the events later roadmap phases consume. Phase 0 wires only
// `session_state` and `shot`; the rest are declared here so adding a feature is
// a store/handler change, not a type-hunting exercise.

// `shot` event payload. The web UI also receives `stats` alongside the shot;
// mobile derives its own stats from the shot list, so only `shot` is modelled.
//
// `shot_update` carries the same envelope: the server re-emits a shot it has
// already sent, under the same shot_number, once optional hardware enrichment
// finishes or is skipped. Its extra `stats`, `pending` and `enrichment` keys
// are not modelled because mobile does not read them.
export interface ShotEnvelope {
  shot: Shot;
}

// `session_state` event payload (emitted after `get_session`). The server sends
// shots oldest-first; the store inverts this to its newest-first invariant.
export interface SessionStatePayload {
  shots: Shot[];
  // The club the server is attributing shots to, so a reconnecting client
  // restores the selection instead of assuming one. Absent on older servers.
  club?: string;
  mock_mode?: boolean;
  debug_mode?: boolean;
  player_name?: string;
}

// `shot_processing` event: the capture/analysis lifecycle for the live view.
export type ShotProcessingState = 'capturing' | 'calculating' | 'failed';

// `club_changed` / `player_changed`: server-pushed selection changes to reflect
// back into the local pickers without echoing to the server.
export interface ClubChangedPayload {
  club: string;
}

export interface PlayerChangedPayload {
  player_name: string;
}

// --- Device status (mirrors src/openflight/server.py and power/models.py) ---
// What the phone can learn about the hardware it is driving. On a headless Pi
// this is the only window onto the radar and the battery, so every field is
// reported as the server states it rather than smoothed into something tidier.

// `trigger_status`, built by _get_trigger_status() in server.py. Requested with
// `get_trigger_status`, pushed on connect, and pushed again after each shot.
export interface TriggerStatusPayload {
  mode: 'rolling-buffer' | 'mock' | 'swing-speed';
  // The detector driving captures; null outside rolling-buffer mode.
  trigger_type: string | null;
  // The server reports this as `monitor is not None and not mock_mode`, so it
  // is false in mock mode even though the mock is working perfectly. Read it
  // alongside `mode` before calling a radar offline.
  radar_connected: boolean;
  radar_port: string | null;
  triggers_total: number;
  triggers_accepted: number;
  triggers_rejected: number;
}

// PowerState in power/models.py. 'unavailable' is what a mains-powered Pi with
// no battery provider reports -- an answer, not a missing reading.
export type PowerState = 'plugged_in' | 'on_battery' | 'low' | 'critical' | 'unavailable';

// --- Device controls (mirror src/openflight/server.py) ---
// Only debug recording for now. Radar tuning (`set_radar_config`) is not
// modelled: the server refuses it in mock mode, so it cannot be exercised
// without hardware. Camera capture settings (`get_camera_capture_settings`)
// are left for their own change.

// `debug_status`, from handle_get_debug_status in server.py. Debug mode
// writes a JSONL log on the Pi; the path is where it landed.
export interface DebugStatusPayload {
  enabled: boolean;
  log_path: string | null;
}

// `debug_toggled`, from handle_toggle_debug in server.py. The server sends
// log_path only when enabling, and omits the key entirely when disabling.
export interface DebugToggledPayload {
  enabled: boolean;
  log_path?: string;
}

// `power_status`, from PowerStatus.to_dict(). Every measurement is nullable
// because a Pi without a battery HAT still reports its absence.
export interface PowerStatusPayload {
  available: boolean;
  provider: string;
  state: PowerState;
  battery_percent: number | null;
  battery_voltage_v: number | null;
  external_power: boolean | null;
  // ISO-8601 UTC.
  updated_at: string;
  error: string | null;
}
