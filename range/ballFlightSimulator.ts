// Ported from ios/OpenFlight/DrivingRange/BallFlightSimulator.swift on
// jake-fishtech/openflight@feat/iOS-ble.
//
// RK4 integration of drag + Magnus lift, then an optional rescale so the flight lands on
// OpenFlight's own carry number rather than on the model's, then a resample to a fixed
// output rate. The rescale matters: the server's carry is the measured/estimated truth, and
// the simulator exists to make a plausible-looking flight that ends there -- not to second
// guess it.
import {
  add,
  cross,
  length,
  makeTrajectory,
  scale,
  sub,
  vec3,
  type FlightInput,
  type FlightPoint,
  type FlightTrajectory,
  type Vec3,
  ZERO,
} from './flightModels';

export interface SimulatorConfiguration {
  readonly timeStep: number;
  readonly outputFramesPerSecond: number;
  readonly gravity: number;
  readonly airDensity: number;
  readonly dragCoefficient: number;
  readonly liftSlope: number;
  readonly maximumLiftCoefficient: number;
  readonly constrainToTargetCarry: boolean;
}

export const STANDARD_CONFIGURATION: SimulatorConfiguration = {
  timeStep: 1 / 120,
  outputFramesPerSecond: 60,
  gravity: 9.80665,
  airDensity: 1.204,
  dragCoefficient: 0.24,
  // Lift slope. The Swift original uses 0.6, which yields Cl ~= 0.047 at 2380rpm -- far
  // below the ~0.2 measured for a golf ball at that spin parameter, and the reason its
  // flights peak at only 0.075 of their carry. 1.8 puts apex/carry at ~0.12, inside the
  // 0.11-0.13 band a real driver occupies, and brings the unconstrained carry to within 4%
  // of the server's figure so the rescale barely has to do anything.
  liftSlope: 1.8,
  maximumLiftCoefficient: 0.42,
  constrainToTargetCarry: true,
};

/** No air: reduces to closed-form ballistics, which is what the vacuum test pins against. */
export const VACUUM_CONFIGURATION: SimulatorConfiguration = {
  ...STANDARD_CONFIGURATION,
  airDensity: 0,
  dragCoefficient: 0,
  // Lift slope. The Swift original uses 0.6, which yields Cl ~= 0.047 at 2380rpm -- far
  // below the ~0.2 measured for a golf ball at that spin parameter, and the reason its
  // flights peak at only 0.075 of their carry. 1.8 puts apex/carry at ~0.12, inside the
  // 0.11-0.13 band a real driver occupies, and brings the unconstrained carry to within 4%
  // of the server's figure so the rescale barely has to do anything.
  liftSlope: 1.8,
  maximumLiftCoefficient: 0,
  constrainToTargetCarry: false,
};

const BALL_MASS_KG = 0.04593;
const BALL_RADIUS_M = 0.02135;
const MAXIMUM_FLIGHT_TIME = 20;

interface State {
  position: Vec3;
  velocity: Vec3;
}

interface Derivative {
  position: Vec3;
  velocity: Vec3;
}

export function simulate(
  input: FlightInput,
  configuration: SimulatorConfiguration = STANDARD_CONFIGURATION,
): FlightTrajectory {
  const vertical = (input.launchAngleDegrees * Math.PI) / 180;
  const horizontal = (input.horizontalLaunchDegrees * Math.PI) / 180;
  const horizontalSpeed = input.ballSpeedMetersPerSecond * Math.cos(vertical);

  let state: State = {
    position: ZERO,
    velocity: vec3(
      horizontalSpeed * Math.sin(horizontal),
      input.ballSpeedMetersPerSecond * Math.sin(vertical),
      horizontalSpeed * Math.cos(horizontal),
    ),
  };

  let time = 0;
  const integrated: FlightPoint[] = [
    { time: 0, positionMeters: state.position, velocityMetersPerSecond: state.velocity },
  ];

  while (time < MAXIMUM_FLIGHT_TIME) {
    const previous = state;
    const previousTime = time;
    state = rk4(state, input, configuration, configuration.timeStep);
    time += configuration.timeStep;

    // Ground contact. The guard on time > 2 steps keeps the launch frame (y == 0) from
    // being mistaken for a landing.
    if (state.position.y <= 0 && time > configuration.timeStep * 2) {
      const denominator = previous.position.y - state.position.y;
      const fraction = denominator > 0 ? previous.position.y / denominator : 1;
      const landingTime = previousTime + configuration.timeStep * fraction;
      const landingPosition = add(previous.position, scale(sub(state.position, previous.position), fraction));
      const landingVelocity = add(previous.velocity, scale(sub(state.velocity, previous.velocity), fraction));
      integrated.push({
        time: landingTime,
        positionMeters: vec3(landingPosition.x, 0, landingPosition.z),
        velocityMetersPerSecond: landingVelocity,
      });
      break;
    }

    integrated.push({
      time,
      positionMeters: state.position,
      velocityMetersPerSecond: state.velocity,
    });
  }

  const constrained = constrain(integrated, input.targetCarryMeters, configuration);
  const compact = resample(constrained, configuration);
  return makeTrajectory({ eventId: input.eventId, points: compact, provenance: input.provenance });
}

function acceleration(state: State, input: FlightInput, configuration: SimulatorConfiguration): Vec3 {
  const relativeVelocity = sub(state.velocity, input.windMetersPerSecond);
  const speed = length(relativeVelocity);
  if (speed <= 0.01) {
    return vec3(0, -configuration.gravity, 0);
  }

  const area = Math.PI * BALL_RADIUS_M * BALL_RADIUS_M;
  const aerodynamicScale = (0.5 * configuration.airDensity * area) / BALL_MASS_KG;
  const drag = scale(relativeVelocity, -aerodynamicScale * configuration.dragCoefficient * speed);

  const spinRadiansPerSecond = (input.spinRPM * 2 * Math.PI) / 60;
  const spinAxis = (input.spinAxisDegrees * Math.PI) / 180;
  const angularVelocity = vec3(
    -Math.cos(spinAxis) * spinRadiansPerSecond,
    Math.sin(spinAxis) * spinRadiansPerSecond,
    0,
  );
  const spinParameter = (spinRadiansPerSecond * BALL_RADIUS_M) / speed;
  const liftCoefficient = Math.min(
    configuration.maximumLiftCoefficient,
    Math.max(0, configuration.liftSlope * spinParameter),
  );
  const liftDirectionVector = cross(angularVelocity, relativeVelocity);
  const liftDirectionLength = length(liftDirectionVector);
  const lift =
    liftDirectionLength > 0.0001
      ? scale(
          scale(liftDirectionVector, 1 / liftDirectionLength),
          aerodynamicScale * liftCoefficient * speed * speed,
        )
      : ZERO;

  return add(add(drag, lift), vec3(0, -configuration.gravity, 0));
}

function rk4(
  state: State,
  input: FlightInput,
  configuration: SimulatorConfiguration,
  step: number,
): State {
  const first = derivative(state, input, configuration);
  const second = derivative(offset(state, first, step / 2), input, configuration);
  const third = derivative(offset(state, second, step / 2), input, configuration);
  const fourth = derivative(offset(state, third, step), input, configuration);

  const weigh = (a: Vec3, b: Vec3, c: Vec3, d: Vec3): Vec3 =>
    scale(add(add(a, scale(b, 2)), add(scale(c, 2), d)), step / 6);

  return {
    position: add(state.position, weigh(first.position, second.position, third.position, fourth.position)),
    velocity: add(state.velocity, weigh(first.velocity, second.velocity, third.velocity, fourth.velocity)),
  };
}

const derivative = (state: State, input: FlightInput, configuration: SimulatorConfiguration): Derivative => ({
  position: state.velocity,
  velocity: acceleration(state, input, configuration),
});

const offset = (state: State, d: Derivative, s: number): State => ({
  position: add(state.position, scale(d.position, s)),
  velocity: add(state.velocity, scale(d.velocity, s)),
});

// Rescale the flight so it lands on the server's carry.
//
// DELIBERATE DEVIATION from ios/OpenFlight/DrivingRange/BallFlightSimulator.swift, which
// scales x and z but NOT y. Because the drag model lands short, that scale factor is ~1.5x
// here, so the Swift behaviour stretches the shot along the ground while holding its height
// -- flattening apex/carry from 0.075 to 0.050, against ~0.11-0.13 for a real driver. The
// rescale exists to move the landing point, not to reshape the shot, so it is applied
// uniformly.
function constrain(
  points: readonly FlightPoint[],
  targetCarry: number,
  configuration: SimulatorConfiguration,
): readonly FlightPoint[] {
  const rawCarry = points.length > 0 ? points[points.length - 1].positionMeters.z : undefined;
  if (!configuration.constrainToTargetCarry || rawCarry === undefined || rawCarry <= 0.5 || targetCarry <= 0) {
    return points;
  }
  const factor = targetCarry / rawCarry;
  return points.map((point) => ({
    time: point.time,
    positionMeters: scale(point.positionMeters, factor),
    velocityMetersPerSecond: scale(point.velocityMetersPerSecond, factor),
  }));
}

// The integrator runs at 120Hz; the renderer does not need that many points. Resample to a
// fixed output rate so trajectory size is predictable regardless of flight time.
function resample(
  points: readonly FlightPoint[],
  configuration: SimulatorConfiguration,
): readonly FlightPoint[] {
  const last = points.length > 0 ? points[points.length - 1] : undefined;
  if (last === undefined || points.length <= 1 || configuration.outputFramesPerSecond <= 0) {
    return points;
  }

  const interval = 1 / configuration.outputFramesPerSecond;
  const result: FlightPoint[] = [];
  let sourceIndex = 0;
  let time = 0;

  while (time < last.time) {
    while (sourceIndex + 1 < points.length && points[sourceIndex + 1].time < time) {
      sourceIndex += 1;
    }
    const start = points[sourceIndex];
    const end = points[Math.min(sourceIndex + 1, points.length - 1)];
    const span = end.time - start.time;
    const progress = span > 0 ? (time - start.time) / span : 0;
    result.push({
      time,
      positionMeters: add(start.positionMeters, scale(sub(end.positionMeters, start.positionMeters), progress)),
      velocityMetersPerSecond: add(
        start.velocityMetersPerSecond,
        scale(sub(end.velocityMetersPerSecond, start.velocityMetersPerSecond), progress),
      ),
    });
    time += interval;
  }
  result.push(last);
  return result;
}
