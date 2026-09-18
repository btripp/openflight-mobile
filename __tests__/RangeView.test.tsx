import { fireEvent, render, screen } from '@testing-library/react-native';
import { RangeView } from '../components/range/RangeView';
import { useSessionStore } from '../stores/useSessionStore';
import { socketService } from '../services/socket';
import type { Shot } from '../types';

// With no device, RangeView's GL effect returns before touching three, so the overlay and
// controls are testable without a GPU. three/webgpu is stubbed because it is a large ESM
// build Jest has no reason to parse here.
jest.mock('three/webgpu', () => ({}));
jest.mock('react-native-webgpu', () => {
  const { View } = require('react-native');
  return {
    Canvas: (props: Record<string, unknown>) => <View {...props} />,
    useCanvasRef: () => ({ current: null }),
    useDevice: () => ({ adapter: null, device: null }),
  };
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const shot = (over: Partial<Shot> = {}): Shot => ({
  shot_number: 7,
  ball_speed_mph: 138.2,
  club_speed_mph: 96.4,
  smash_factor: 1.43,
  estimated_carry_yards: 231,
  carry_spin_adjusted: null,
  carry_range: [225, 238],
  club: '3-wood',
  profile_id: null,
  profile_name: null,
  timestamp: '2026-09-17T10:00:00Z',
  launch_angle_vertical: 11.2,
  launch_angle_horizontal: 2.4,
  launch_angle_confidence: 0.8,
  angle_source: 'radar',
  club_angle_deg: null,
  club_path_deg: 1.1,
  spin_axis_deg: -6.2,
  spin_rpm: 3120,
  spin_source: 'measured',
  spin_quality: 'high',
  ...over,
});

describe('driving range', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    useSessionStore.setState({ connectionState: 'disconnected', shots: [] });
  });

  it('shows the latest shot from the session rather than a demo', async () => {
    useSessionStore.setState({ connectionState: 'connected', shots: [shot()] });

    await render(<RangeView />);

    // Values render inside a Text that also carries the unit, so they compose as
    // "138.2 MPH" -- match on the number rather than the whole string.
    expect(screen.getByText(/138\.2/)).toBeTruthy();
    expect(screen.getByText(/96\.4/)).toBeTruthy();
    expect(screen.getByText(/3120/)).toBeTruthy();
    expect(screen.queryByText(/DEMO SHOT/)).toBeNull();
  });

  it('labels the stand-in flight when the session has no shots', async () => {
    await render(<RangeView />);

    // The demo exists so the range is never blank, but it must never pass as measured data.
    expect(screen.getByText(/DEMO SHOT/)).toBeTruthy();
  });

  it('prefers the newest shot when several have arrived', async () => {
    useSessionStore.setState({
      connectionState: 'connected',
      shots: [shot({ shot_number: 9, ball_speed_mph: 151.9 }), shot({ shot_number: 8 })],
    });

    await render(<RangeView />);

    expect(screen.getByText(/151\.9/)).toBeTruthy();
  });

  it('asks the server to simulate a shot', async () => {
    const simulateShot = jest.spyOn(socketService, 'simulateShot').mockImplementation(() => {});
    useSessionStore.setState({ connectionState: 'connected', shots: [shot()] });

    await render(<RangeView />);
    fireEvent.press(screen.getByLabelText('Simulate a shot'));

    expect(simulateShot).toHaveBeenCalledTimes(1);
  });

  it('does not offer to simulate while disconnected', async () => {
    await render(<RangeView />);

    // The request goes to the Pi; offering it while disconnected would be a dead control.
    expect(screen.queryByLabelText('Simulate a shot')).toBeNull();
    expect(screen.getByLabelText('Replay the shot')).toBeTruthy();
  });

  it('shows a dash for a measurement the shot does not carry', async () => {
    useSessionStore.setState({
      connectionState: 'connected',
      shots: [shot({ spin_rpm: null, club_speed_mph: null })],
    });

    await render(<RangeView />);

    // Never invent a number to fill a tile.
    expect(screen.getAllByText(/—/).length).toBeGreaterThanOrEqual(2);
  });
});
