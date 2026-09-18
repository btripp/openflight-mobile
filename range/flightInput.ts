// Builds a simulator FlightInput from a server Shot. This is the job
// ios/OpenFlight/DrivingRange/FlightInputResolver.swift does: convert units once at the
// boundary, and record which parameters had to be estimated because the shot did not carry
// them. AGENTS.md forbids fabricating a measurement, so an absent field is marked estimated
// rather than silently becoming a number that looks measured.
import type { Shot } from '../types';
import { vec3, type FlightInput, type FlightParameter } from './flightModels';

// The wire contract is mph and yards; the simulator works in SI.
export const MPH_TO_METERS_PER_SECOND = 0.44704;
export const YARDS_TO_METERS = 0.9144;

// Used only when the shot does not carry the parameter. Chosen to look plausible for a
// mid-iron, and always reported through `estimatedParameters` so the UI can say so.
const ESTIMATED_LAUNCH_ANGLE_DEGREES = 14;
const ESTIMATED_SPIN_RPM = 2600;

export function flightInputFromShot(shot: Shot, eventId: string): FlightInput {
  const estimated = new Set<FlightParameter>();

  let launchAngleDegrees = shot.launch_angle_vertical;
  if (launchAngleDegrees === null || launchAngleDegrees === undefined) {
    launchAngleDegrees = ESTIMATED_LAUNCH_ANGLE_DEGREES;
    estimated.add('launchAngle');
  }

  let spinRPM = shot.spin_rpm;
  if (spinRPM === null || spinRPM === undefined) {
    spinRPM = ESTIMATED_SPIN_RPM;
    estimated.add('spinRate');
  }

  let horizontalLaunchDegrees = shot.launch_angle_horizontal;
  if (horizontalLaunchDegrees === null || horizontalLaunchDegrees === undefined) {
    horizontalLaunchDegrees = 0;
    estimated.add('horizontalLaunch');
  }

  let spinAxisDegrees = shot.spin_axis_deg;
  if (spinAxisDegrees === null || spinAxisDegrees === undefined) {
    spinAxisDegrees = 0;
    estimated.add('spinAxis');
  }

  return {
    eventId,
    ballSpeedMetersPerSecond: shot.ball_speed_mph * MPH_TO_METERS_PER_SECOND,
    launchAngleDegrees,
    horizontalLaunchDegrees,
    spinRPM,
    spinAxisDegrees,
    // Carry is the server's number and the flight is rescaled to land on it, so a shot with
    // no carry simply leaves the simulation unconstrained rather than inventing a distance.
    targetCarryMeters: shot.estimated_carry_yards * YARDS_TO_METERS,
    windMetersPerSecond: vec3(0, 0, 0),
    provenance: { estimatedParameters: estimated, clampedParameters: new Set() },
  };
}
