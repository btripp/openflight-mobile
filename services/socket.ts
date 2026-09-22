import { io, type Socket } from 'socket.io-client';
import { useDeviceStore } from '../stores/useDeviceStore';
import { useSessionStore } from '../stores/useSessionStore';
import { saveServerUrl } from '../storage/connection';
import { getShotRepository } from '../storage/db';
import type {
  CameraStatusPayload,
  DebugStatusPayload,
  DebugToggledPayload,
  PowerStatusPayload,
  SessionStatePayload,
  Shot,
  ShotEnvelope,
  TriggerStatusPayload,
} from '../types';

// Singleton Socket.IO client, mirroring the web app's socketService shape: one
// place that maps every server event onto a store mutation. Kept out of the
// React tree so a reconnect or a background disconnect doesn't depend on any
// screen being mounted.
//
// Reconnection is handled by Socket.IO itself (exponential backoff, enabled by
// default); the handlers here just reflect the resulting connection state and
// re-sync the session on every (re)connect.
class SocketService {
  private socket: Socket | null = null;
  // Address the current socket was opened against. The connect guard keys on
  // this as well as connection state, so changing the address can replace an
  // in-flight attempt instead of being swallowed by it.
  private url: string | null = null;

  connect(url: string): void {
    const store = useSessionStore.getState();

    // A live or in-flight attempt to this same address already exists — ignore,
    // so we don't thrash a healthy connection or stack duplicate attempts. A
    // different address means the user corrected the server, so the outstanding
    // attempt is abandoned in favour of the new one rather than ignored.
    const state = store.connectionState;
    if (this.socket && this.url === url && (state === 'connecting' || state === 'connected')) {
      return;
    }

    // Otherwise a socket may still be assigned — either from a failed attempt
    // (Socket.IO leaves it in place on connect_error) or from an attempt being
    // replaced above. Tear it down so the new attempt starts fresh; without
    // this, a second Connect tap was swallowed and the only recovery was
    // reloading the app.
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    // Device status describes the server that reported it. Switching servers
    // must not leave another Pi's radar port and battery on screen until the
    // new one answers.
    if (this.url !== null && this.url !== url) {
      useDeviceStore.getState().reset();
    }

    store.setConnectionState('connecting');
    this.url = url;

    const socket = io(url, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
    });
    this.socket = socket;
    this.registerHandlers(socket, url);
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
    this.url = null;
    useSessionStore.getState().setConnectionState('disconnected');
    // Only the deliberate disconnect forgets the device. A transient drop is
    // handled by the 'disconnect' event below, which leaves the last reading
    // in place: blanking the radar and battery every time the wifi hiccups
    // would read as hardware failing rather than a wobbly link.
    useDeviceStore.getState().reset();
  }

  simulateShot(): void {
    this.socket?.emit('simulate_shot');
  }

  // --- Device controls ---
  // Each toggle is fire-and-forget: the server flips the state and broadcasts
  // the result (`debug_toggled`, `camera_status`) to every client, so there is
  // nothing to update optimistically and nothing to roll back. A refusal --
  // streaming with the camera off, or a camera that never initialised --
  // arrives in that same broadcast with an `error` set.

  toggleDebug(): void {
    this.emitWhileConnected('toggle_debug');
  }

  toggleCamera(): void {
    this.emitWhileConnected('toggle_camera');
  }

  toggleCameraStream(): void {
    this.emitWhileConnected('toggle_camera_stream');
  }

  // Socket.IO keeps the socket through a transient drop and buffers anything
  // emitted meanwhile, replaying it on reconnect. A toggle tapped while the
  // wifi was away would then land later and flip recording or the camera
  // behind the user's back, so a change is sent only over a live connection.
  //
  // Named to match the identical helper on the club-selection branch: both
  // features need exactly this guard, and whichever merges second should
  // delete its copy rather than keep two.
  private emitWhileConnected(event: string, payload?: object): void {
    if (!this.socket?.connected) return;
    if (payload === undefined) this.socket.emit(event);
    else this.socket.emit(event, payload);
  }

  // Files one shot under the current visit. Callers fire and forget, so this
  // absorbs every failure itself rather than leaving a rejected promise loose.
  private async persistShot(shot: Shot): Promise<void> {
    try {
      const { sessionId } = useSessionStore.getState();
      // Shots only arrive over an established connection, which is what starts
      // a session; without one there is nothing to file this under.
      if (sessionId === null) return;

      const repository = await getShotRepository();
      await repository.saveShot(sessionId, shot);
    } catch {
      // History loses a shot; the live view already has it.
    }
  }

  private registerHandlers(socket: Socket, url: string): void {
    const store = useSessionStore.getState;

    socket.on('connect', () => {
      store().setConnectionState('connected');
      // A session is one connection span, so every reconnect files the shots
      // that follow under a fresh visit in on-device history.
      store().startSession();
      // Remember a URL only once it actually connects, so we never persist a
      // typo'd address that never worked.
      void saveServerUrl(url);
      // Re-sync the full session on every (re)connect, not just the first.
      socket.emit('get_session');
      // The server pushes trigger status on connect too, but a phone joining a
      // session that is already running cannot rely on having seen that push --
      // and the hardware may have changed while it was away. Read-only, so it
      // needs no connected-only guard: a replayed request costs a snapshot.
      socket.emit('get_trigger_status');
      // Same reasoning as the trigger status: these are pushed on connect by
      // the server, but a phone joining a session already in progress cannot
      // rely on having seen that push. All three are read-only requests.
      socket.emit('get_debug_status');
      socket.emit('get_camera_status');
    });

    socket.on('disconnect', () => {
      // A transient drop: Socket.IO will attempt to reconnect in the
      // background. Surface it as disconnected until 'connect' fires again.
      store().setConnectionState('disconnected');
    });

    socket.on('connect_error', () => {
      store().setConnectionState('error');
    });

    socket.on('session_state', (data: SessionStatePayload) => {
      store().setShots(data.shots);
    });

    socket.on('shot', (data: ShotEnvelope) => {
      store().addShot(data.shot);
      // Deliberately not awaited: the tile on screen must never wait on a disk
      // write. The repository swallows its own failures, so history is what is
      // lost when storage misbehaves, not the shot.
      void this.persistShot(data.shot);
    });

    // When optional hardware can add seconds to a shot, the server publishes
    // provisional metrics as `shot` and then re-publishes the same shot — same
    // shot_number — as `shot_update`, either enriched or marked skipped. Both
    // the live list and history therefore update that shot rather than gaining
    // a second copy of it.
    socket.on('shot_update', (data: ShotEnvelope) => {
      store().replaceShot(data.shot);
      void this.persistShot(data.shot);
    });

    // Device health. Both arrive unprompted on connect and again whenever they
    // change -- trigger status also after every shot -- and each payload is a
    // complete snapshot, so the store applies it verbatim. The store guards a
    // malformed payload rather than blanking the panel mid-session.
    socket.on('trigger_status', (data: TriggerStatusPayload) => {
      useDeviceStore.getState().applyTriggerStatus(data);
    });

    socket.on('power_status', (data: PowerStatusPayload) => {
      useDeviceStore.getState().applyPowerStatus(data);
    });

    // Debug recording. The server answers a query with `debug_status` and a
    // toggle with `debug_toggled` -- same meaning, and the latter omits
    // log_path when switching off, which the store reads as "no log".
    socket.on('debug_status', (data: DebugStatusPayload) => {
      useDeviceStore.getState().applyDebugStatus(data);
    });

    socket.on('debug_toggled', (data: DebugToggledPayload) => {
      useDeviceStore.getState().applyDebugStatus(data);
    });

    // Broadcast after every camera change, including one the server refused.
    socket.on('camera_status', (data: CameraStatusPayload) => {
      useDeviceStore.getState().applyCameraStatus(data);
    });
  }
}

export const socketService = new SocketService();
