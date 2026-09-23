import { requestShutdown } from '../services/shutdown';

// The kiosk posts to a relative '/api/shutdown' because it is served by the Pi
// itself (ui/src/hooks/useSocket.ts). A phone is not, so the address it
// connected to has to be turned into an absolute URL here.
const originalFetch = globalThis.fetch;

function mockFetch(implementation: jest.Mock) {
  globalThis.fetch = implementation as unknown as typeof fetch;
  return implementation;
}

function ok() {
  return jest.fn(() => Promise.resolve({ ok: true, status: 200 }));
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('requestShutdown', () => {
  it('posts to the shutdown endpoint of the server the phone is talking to', async () => {
    const fetchMock = mockFetch(ok());

    await requestShutdown('http://192.168.1.100:8080');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.1.100:8080/api/shutdown',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('does not double the slash when the address already ends in one', async () => {
    // The field accepts whatever the user typed, and a trailing slash is a
    // normal thing to type.
    const fetchMock = mockFetch(ok());

    await requestShutdown('http://192.168.1.100:8080/');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.1.100:8080/api/shutdown',
      expect.anything(),
    );
  });

  it('reports a refusal from the server rather than claiming the Pi stopped', async () => {
    // Telling someone the Pi is down when it is still running invites them to
    // pull the plug, which is the exact thing this feature exists to prevent.
    mockFetch(jest.fn(() => Promise.resolve({ ok: false, status: 500 })));

    await expect(requestShutdown('http://192.168.1.100:8080')).rejects.toThrow(/500/);
  });

  it('reports a request that never reached the server', async () => {
    mockFetch(jest.fn(() => Promise.reject(new Error('Network request failed'))));

    await expect(requestShutdown('http://192.168.1.100:8080')).rejects.toThrow();
  });

  it('gives up rather than hanging on a Pi that never answers', async () => {
    // A Pi that is already off the network accepts the connection and then
    // says nothing. Without a bound, the screen sits on a spinner forever and
    // the user cannot tell whether the server stopped -- which is not an
    // observable end state.
    //
    // Fake timers both prove the abort actually fires at the deadline and
    // stop the real 10s timer outliving the test.
    jest.useFakeTimers();
    try {
      const fetchMock = jest.fn(
        (_url: string, options: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () =>
              reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })),
            );
          }),
      );
      mockFetch(fetchMock as unknown as jest.Mock);

      const pending = requestShutdown('http://192.168.1.100:8080');
      jest.advanceTimersByTime(10_000);

      await expect(pending).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledWith(
        'http://192.168.1.100:8080/api/shutdown',
        expect.objectContaining({ signal: expect.anything() }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('works on a runtime whose AbortSignal has no timeout() helper', async () => {
    // Regression: React Native polyfills AbortController/AbortSignal from
    // abort-controller v3 (react-native/Libraries/Core/setUpXHR.js), which has
    // no static AbortSignal.timeout(). Jest runs on Node, where it does exist,
    // so a test that leaves it in place cannot tell the two runtimes apart --
    // and an earlier version of this file used it, which threw while building
    // the fetch options on device. Every shutdown then reported failure
    // without a request ever leaving the phone.
    const AS = AbortSignal as unknown as { timeout?: unknown };
    const original = AS.timeout;
    delete AS.timeout;

    try {
      const fetchMock = ok();
      mockFetch(fetchMock);

      await expect(requestShutdown('http://192.168.1.100:8080')).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith(
        'http://192.168.1.100:8080/api/shutdown',
        expect.objectContaining({ signal: expect.anything() }),
      );
    } finally {
      AS.timeout = original;
    }
  });

  it('reports a timeout as a failure the user can retry', async () => {
    mockFetch(
      jest.fn(() => Promise.reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))),
    );

    await expect(requestShutdown('http://192.168.1.100:8080')).rejects.toThrow();
  });

  it('resolves when the server accepts the request', async () => {
    // The server answers 200 and only then exits, so a resolved promise means
    // "accepted", not "already stopped".
    mockFetch(ok());

    await expect(requestShutdown('http://192.168.1.100:8080')).resolves.toBeUndefined();
  });
});
