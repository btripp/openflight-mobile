// Ported from ios/OpenFlight/DrivingRange/BallFlightModels.swift on
// jake-fishtech/openflight@feat/iOS-ble. Pure domain logic: no I/O, no React, no renderer.
//
// Swift uses SIMD3<Double>; the equivalent here is a plain readonly triple, kept structural
// so trajectories stay cheap to copy and trivial to assert against.

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const ZERO: Vec3 = vec3(0, 0, 0);

export const add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => vec3(a.x * s, a.y * s, a.z * s);
export const length = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

// Which flight parameters were estimated rather than measured, and which were clamped into
// a plausible range. Carried through to the UI so an estimated flight can be shown as such
// rather than presented with the same authority as a measured one.
export type FlightParameter = 'launchAngle' | 'horizontalLaunch' | 'spinRate' | 'spinAxis';

export interface FlightInputProvenance {
  readonly estimatedParameters: ReadonlySet<FlightParameter>;
  readonly clampedParameters: ReadonlySet<FlightParameter>;
}

export const usesEstimatedFlight = (p: FlightInputProvenance): boolean =>
  p.estimatedParameters.has('launchAngle') || p.estimatedParameters.has('spinRate');

export interface FlightInput {
  readonly eventId: string;
  readonly ballSpeedMetersPerSecond: number;
  readonly launchAngleDegrees: number;
  readonly horizontalLaunchDegrees: number;
  readonly spinRPM: number;
  readonly spinAxisDegrees: number;
  readonly targetCarryMeters: number;
  readonly windMetersPerSecond: Vec3;
  readonly provenance: FlightInputProvenance;
}

export interface FlightPoint {
  readonly time: number;
  readonly positionMeters: Vec3;
  readonly velocityMetersPerSecond: Vec3;
}

export interface FlightTrajectory {
  readonly id: string;
  readonly eventId: string;
  readonly points: readonly FlightPoint[];
  readonly apexMeters: number;
  readonly flightTime: number;
  readonly carryMeters: number;
  readonly lateralMeters: number;
  readonly provenance: FlightInputProvenance;
}

// Mirrors the Swift initialiser, which derives apex/flightTime/carry/lateral from the
// points rather than accepting them, so they can never disagree with the trajectory.
export function makeTrajectory(args: {
  id?: string;
  eventId: string;
  points: readonly FlightPoint[];
  provenance: FlightInputProvenance;
}): FlightTrajectory {
  const { points } = args;
  const last = points.length > 0 ? points[points.length - 1] : undefined;
  return {
    id: args.id ?? args.eventId,
    eventId: args.eventId,
    points,
    apexMeters: points.reduce((max, p) => Math.max(max, p.positionMeters.y), 0),
    flightTime: last?.time ?? 0,
    carryMeters: last?.positionMeters.z ?? 0,
    lateralMeters: last?.positionMeters.x ?? 0,
    provenance: args.provenance,
  };
}

// Swift: min(max(flightTime * 0.68, 3.5), 6.0) — replay is deliberately slower than real
// time at the short end and capped at the long end.
export const playbackDuration = (t: FlightTrajectory): number =>
  Math.min(Math.max(t.flightTime * 0.68, 3.5), 6.0);

/** Interpolate the flight at an arbitrary time. Clamps to the first/last point. */
export function pointAt(trajectory: FlightTrajectory, time: number): FlightPoint | null {
  const { points } = trajectory;
  if (points.length === 0) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (time <= first.time) return first;
  if (time >= last.time) return last;

  let lower = 0;
  let upper = points.length - 1;
  while (upper - lower > 1) {
    const middle = Math.floor((lower + upper) / 2);
    if (points[middle].time <= time) {
      lower = middle;
    } else {
      upper = middle;
    }
  }

  const start = points[lower];
  const end = points[upper];
  const interval = end.time - start.time;
  if (interval <= 0) return start;
  const progress = (time - start.time) / interval;
  return {
    time,
    positionMeters: add(start.positionMeters, scale(sub(end.positionMeters, start.positionMeters), progress)),
    velocityMetersPerSecond: add(
      start.velocityMetersPerSecond,
      scale(sub(end.velocityMetersPerSecond, start.velocityMetersPerSecond), progress),
    ),
  };
}
