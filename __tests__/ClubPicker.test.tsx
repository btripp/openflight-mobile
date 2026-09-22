import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { ClubPicker } from '../components/ClubPicker';
import { socketService } from '../services/socket';
import { useSessionStore } from '../stores/useSessionStore';
import type { ConnectionState } from '../types';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

// The socket service is exercised directly in socket.test.ts; here we only care
// that the picker wires the user's choice to it.
jest.mock('../services/socket', () => ({
  socketService: { setClub: jest.fn() },
}));

const mockedSocket = socketService as jest.Mocked<typeof socketService>;

// render() and fireEvent are asynchronous in React Native Testing Library 14;
// every call is awaited so state is committed before the next assertion.
async function renderPicker(connectionState: ConnectionState, club: string | null) {
  useSessionStore.setState({ connectionState, club });
  await render(<ClubPicker />);
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('ClubPicker', () => {
  it('shows the club the server is filing shots under', async () => {
    await renderPicker('connected', '7-iron');

    expect(screen.getByLabelText('Club: 7 Iron. Change club')).toBeTruthy();
  });

  it('says so when the server has not reported a club', async () => {
    await renderPicker('connected', null);

    expect(screen.getByLabelText('Club: not set. Change club')).toBeTruthy();
  });

  it('lists every club by type and marks the current one', async () => {
    await renderPicker('connected', '7-iron');

    await fireEvent.press(screen.getByLabelText('Club: 7 Iron. Change club'));

    expect(screen.getByText('Irons')).toBeTruthy();
    expect(screen.getByText('Hybrids')).toBeTruthy();
    expect(screen.getByText('Woods')).toBeTruthy();
    expect(screen.getByRole('button', { name: '7 Iron', selected: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Driver', selected: false })).toBeTruthy();
  });

  it('asks the server for the picked club and closes', async () => {
    await renderPicker('connected', 'driver');
    await fireEvent.press(screen.getByLabelText('Club: Driver. Change club'));

    await fireEvent.press(screen.getByRole('button', { name: 'Pitching Wedge' }));

    expect(mockedSocket.setClub).toHaveBeenCalledWith('pw');
    expect(screen.queryByText('Irons')).toBeNull();
  });

  it('keeps showing the current club until the server confirms the change', async () => {
    await renderPicker('connected', 'driver');
    await fireEvent.press(screen.getByLabelText('Club: Driver. Change club'));

    await fireEvent.press(screen.getByRole('button', { name: 'Pitching Wedge' }));

    expect(screen.getByLabelText('Club: Driver. Change club')).toBeTruthy();
  });

  it('closes without a change', async () => {
    await renderPicker('connected', 'driver');
    await fireEvent.press(screen.getByLabelText('Club: Driver. Change club'));

    await fireEvent.press(screen.getByRole('button', { name: 'Close club list' }));

    expect(mockedSocket.setClub).not.toHaveBeenCalled();
    expect(screen.queryByText('Irons')).toBeNull();
  });

  it.each<ConnectionState>(['disconnected', 'connecting', 'error'])(
    'cannot be changed while %s',
    async (connectionState) => {
      // A pick that cannot reach the server must not look as though it did.
      await renderPicker(connectionState, 'driver');
      const trigger = screen.getByLabelText('Club: Driver. Change club');

      expect(trigger).toBeDisabled();
      await fireEvent.press(trigger);
      expect(screen.queryByText('Irons')).toBeNull();
    },
  );

  it('closes the list if the connection drops while it is open', async () => {
    await renderPicker('connected', 'driver');
    await fireEvent.press(screen.getByLabelText('Club: Driver. Change club'));

    await act(() => useSessionStore.setState({ connectionState: 'disconnected' }));

    expect(screen.queryByText('Irons')).toBeNull();
  });
});
