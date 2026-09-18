import { fireEvent, render, screen } from '@testing-library/react-native';
import LiveScreen from '../app/(tabs)/index';
import { useSessionStore } from '../stores/useSessionStore';
import type { Shot } from '../types';

let mockColorScheme = 'dark';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockColorScheme,
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const shot: Shot = {
  shot_number: 1,
  ball_speed_mph: 152.4,
  club_speed_mph: 104.2,
  smash_factor: 1.46,
  estimated_carry_yards: 241,
  carry_spin_adjusted: null,
  carry_range: [235, 250],
  club: 'driver',
  profile_id: null,
  profile_name: null,
  timestamp: '2026-09-11T12:00:00Z',
  launch_angle_vertical: 12.3,
  launch_angle_horizontal: null,
  launch_angle_confidence: 0.8,
  angle_source: 'radar',
  club_angle_deg: null,
  club_path_deg: null,
  spin_axis_deg: null,
  spin_rpm: 2650,
  spin_source: 'measured',
  spin_quality: 'medium',
};

// The restyle must not change what the Live screen shows or offers, in either
// appearance.
describe.each(['dark', 'light'])('Live screen in %s mode', (scheme) => {
  beforeEach(() => {
    mockColorScheme = scheme;
    mockPush.mockClear();
    useSessionStore.setState({ connectionState: 'disconnected', shots: [] });
  });

  it('offers the connection controls while disconnected', async () => {
    await render(<LiveScreen />);

    expect(screen.getByText('Disconnected')).toBeTruthy();
    expect(screen.getByPlaceholderText('http://<pi-ip>:8080')).toBeTruthy();
    expect(screen.getByText('Connect')).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
  });

  it('shows the latest shot once connected', async () => {
    useSessionStore.setState({ connectionState: 'connected', shots: [shot] });

    await render(<LiveScreen />);

    expect(screen.getByText('Simulate Shot')).toBeTruthy();
    expect(screen.getByText('152.4')).toBeTruthy();
    expect(screen.getByText('241')).toBeTruthy();
    expect(screen.getByText('2,650')).toBeTruthy();
  });
});

// The range is reachable from Live. It is the entry point to the feature the port exists
// for, so losing it silently would be worse than it looks.
describe('driving range entry point', () => {
  beforeEach(() => {
    mockColorScheme = 'dark';
    mockPush.mockClear();
    useSessionStore.setState({ connectionState: 'disconnected', shots: [] });
  });

  it('offers the range from the Live screen', async () => {
    await render(<LiveScreen />);

    expect(screen.getByLabelText('Open the driving range')).toBeTruthy();
    expect(screen.getByText('Driving range')).toBeTruthy();
  });

  it('opens the range when it is tapped', async () => {
    await render(<LiveScreen />);

    fireEvent.press(screen.getByLabelText('Open the driving range'));

    expect(mockPush).toHaveBeenCalledWith('/range');
  });

  it('offers the range even before a shot has arrived', async () => {
    useSessionStore.setState({ connectionState: 'connected', shots: [] });

    await render(<LiveScreen />);

    expect(screen.getByLabelText('Open the driving range')).toBeTruthy();
  });
});
