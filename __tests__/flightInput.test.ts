import { flightInputFromShot, MPH_TO_METERS_PER_SECOND, YARDS_TO_METERS } from '../range/flightInput';
import type { Shot } from '../types';

const baseShot: Shot = {
  shot_number: 1,
  ball_speed_mph: 151.4,
  club_speed_mph: 103.2,
  smash_factor: 1.47,
  estimated_carry_yards: 264,
  carry_spin_adjusted: null,
  carry_range: [255, 270],
  club: 'driver',
  profile_id: null,
  profile_name: null,
  timestamp: '2026-08-06T01:00:00Z',
  launch_angle_vertical: 12.6,
  launch_angle_horizontal: -1.3,
  launch_angle_confidence: 0.9,
  angle_source: 'radar',
  club_angle_deg: null,
  club_path_deg: 2.1,
  spin_axis_deg: -3.4,
  spin_rpm: 2380,
  spin_source: 'measured',
  spin_quality: 'high',
};

describe('flight input from a shot', () => {
  it('converts the wire units to SI exactly once', () => {
    const input = flightInputFromShot(baseShot, 'e1');

    expect(input.ballSpeedMetersPerSecond).toBeCloseTo(151.4 * MPH_TO_METERS_PER_SECOND, 6);
    expect(input.targetCarryMeters).toBeCloseTo(264 * YARDS_TO_METERS, 6);
    // Angles and spin are already in the units the simulator wants.
    expect(input.launchAngleDegrees).toBe(12.6);
    expect(input.spinRPM).toBe(2380);
    expect(input.spinAxisDegrees).toBe(-3.4);
  });

  it('marks nothing estimated when the shot carries every field', () => {
    const input = flightInputFromShot(baseShot, 'e1');
    expect(input.provenance.estimatedParameters.size).toBe(0);
  });

  it('reports an estimate rather than passing a missing angle off as measured', () => {
    const input = flightInputFromShot({ ...baseShot, launch_angle_vertical: null }, 'e1');

    expect(input.provenance.estimatedParameters.has('launchAngle')).toBe(true);
    expect(input.launchAngleDegrees).toBeGreaterThan(0);
  });

  it('reports an estimate for missing spin', () => {
    const input = flightInputFromShot({ ...baseShot, spin_rpm: null }, 'e1');
    expect(input.provenance.estimatedParameters.has('spinRate')).toBe(true);
  });

  it('treats a missing spin axis as straight, and says so', () => {
    const input = flightInputFromShot({ ...baseShot, spin_axis_deg: null }, 'e1');

    expect(input.spinAxisDegrees).toBe(0);
    expect(input.provenance.estimatedParameters.has('spinAxis')).toBe(true);
  });
});
