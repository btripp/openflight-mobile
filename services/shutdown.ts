// Graceful shutdown over HTTP.
//
// This is the one server action the phone takes outside the socket. The kiosk
// posts to a relative '/api/shutdown' because the Pi serves it (see
// ui/src/hooks/useSocket.ts); a phone has to address the Pi explicitly, so the
// server URL the user connected to is turned into an absolute endpoint here.
//
// Deliberately not on the socket: `shutdown` exists as a socket event too, but
// the web UI uses the REST route, so both clients exercise the same server
// path. The socket is about to drop anyway -- that is the point.

const SHUTDOWN_PATH = '/api/shutdown';

// A Pi that has already left the network accepts the connection and then says
// nothing. Without a bound the screen sits on a spinner indefinitely, which
// leaves the user unable to tell whether it is safe to cut the power -- not an
// observable end state. Generous enough for a busy Pi on a weak LAN link.
const TIMEOUT_MS = 10_000;

// Deliberately an AbortController rather than AbortSignal.timeout(): React
// Native polyfills AbortController/AbortSignal from abort-controller v3
// (react-native/Libraries/Core/setUpXHR.js), which has no static timeout()
// helper. Calling it threw while building the fetch options -- before any
// request left the phone -- so every shutdown reported failure on device while
// the tests passed on Node, which does have it.

// The server answers 200 and only then halts, on a short delay
// (_shutdown_process_after_delay in server.py). Resolving therefore means the
// Pi accepted the request, not that it has finished stopping.
export async function requestShutdown(serverUrl: string): Promise<void> {
  // The address comes from a text field, so a trailing slash is entirely
  // normal and must not produce '//api/shutdown'.
  const base = serverUrl.replace(/\/+$/, '');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${base}${SHUTDOWN_PATH}`, {
      method: 'POST',
      signal: controller.signal,
    });

    // Anything but a success means the Pi is still running. Saying otherwise
    // would invite someone to pull the power on a live SD card, which is the
    // exact failure this feature exists to prevent -- so this throws rather
    // than degrading quietly, and the caller surfaces it.
    if (!response.ok) {
      throw new Error(`Shutdown request failed (${response.status})`);
    }
  } finally {
    clearTimeout(timer);
  }
}
