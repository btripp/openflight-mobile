// Ported from ios/OpenFlightTests/BallFlightSimulatorTests.swift on
// jake-fishtech/openflight@feat/iOS-ble. The Swift assertions are the specification; the
// tolerances below are the Swift ones unless a comment says why it had to change.
import {
  pointAt,
  vec3,
  ZERO,
  type FlightInput,
  type FlightParameter,
} from '../range/flightModels';
import {
  simulate,
  STANDARD_CONFIGURATION,
  VACUUM_CONFIGURATION,
} from '../range/ballFlightSimulator';

const noProvenance = {
  estimatedParameters: new Set<FlightParameter>(),
  clampedParameters: new Set<FlightParameter>(),
};

function makeInput(overrides: Partial<FlightInput> = {}): FlightInput {
  return {
    eventId: 'test-event',
    ballSpeedMetersPerSecond: 67,
    launchAngleDegrees: 13,
    horizontalLaunchDegrees: 0,
    spinRPM: 2_500,
    spinAxisDegrees: 0,
    targetCarryMeters: 245,
    windMetersPerSecond: ZERO,
    provenance: noProvenance,
    ...overrides,
  };
}

describe('ball flight simulator', () => {
  it('matches closed-form ballistics in a vacuum', () => {
    const speed = 50;
    const angle = 30;
    const trajectory = simulate(
      makeInput({
        ballSpeedMetersPerSecond: speed,
        launchAngleDegrees: angle,
        spinRPM: 0,
        targetCarryMeters: 200,
      }),
      VACUUM_CONFIGURATION,
    );

    const verticalSpeed = speed * Math.sin((angle * Math.PI) / 180);
    const horizontalSpeed = speed * Math.cos((angle * Math.PI) / 180);
    const expectedTime = (2 * verticalSpeed) / 9.80665;
    const expectedCarry = horizontalSpeed * expectedTime;

    expect(trajectory.flightTime).toBeCloseTo(expectedTime, 1);
    expect(Math.abs(trajectory.flightTime - expectedTime)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(trajectory.carryMeters - expectedCarry)).toBeLessThanOrEqual(0.6);
    expect(Math.abs(trajectory.points[trajectory.points.length - 1].positionMeters.y)).toBeLessThanOrEqual(0.0001);
  });

  it('lands on the carry OpenFlight reported', () => {
    const trajectory = simulate(
      makeInput({ ballSpeedMetersPerSecond: 67, launchAngleDegrees: 13, spinRPM: 2_500, targetCarryMeters: 245 }),
    );

    expect(Math.abs(trajectory.carryMeters - 245)).toBeLessThanOrEqual(0.01);
    expect(trajectory.apexMeters).toBeGreaterThan(10);
    expect(trajectory.flightTime).toBeGreaterThan(2);
    expect(trajectory.points.every((p) => p.positionMeters.y >= 0)).toBe(true);
  });

  it('loses carry to drag when unconstrained', () => {
    const input = makeInput({
      ballSpeedMetersPerSecond: 60,
      launchAngleDegrees: 14,
      spinRPM: 0,
      targetCarryMeters: 240,
    });
    const aerodynamic = simulate(input, { ...STANDARD_CONFIGURATION, constrainToTargetCarry: false });
    const vacuum = simulate(input, VACUUM_CONFIGURATION);

    expect(aerodynamic.carryMeters).toBeLessThan(vacuum.carryMeters);
  });

  it('gains lift from backspin', () => {
    const configuration = { ...STANDARD_CONFIGURATION, constrainToTargetCarry: false };
    const base = { ballSpeedMetersPerSecond: 62, launchAngleDegrees: 12, targetCarryMeters: 230 };
    const noSpin = simulate(makeInput({ ...base, spinRPM: 0 }), configuration);
    const backspin = simulate(makeInput({ ...base, spinRPM: 3_000 }), configuration);

    expect(backspin.apexMeters).toBeGreaterThan(noSpin.apexMeters);
    expect(backspin.flightTime).toBeGreaterThan(noSpin.flightTime);
  });

  it('curves according to spin axis, symmetrically', () => {
    const configuration = { ...STANDARD_CONFIGURATION, constrainToTargetCarry: false };
    const fade = simulate(makeInput({ spinAxisDegrees: 18 }), configuration);
    const draw = simulate(makeInput({ spinAxisDegrees: -18 }), configuration);

    expect(fade.lateralMeters).toBeGreaterThan(0);
    expect(draw.lateralMeters).toBeLessThan(0);
    expect(Math.abs(Math.abs(fade.lateralMeters) - Math.abs(draw.lateralMeters))).toBeLessThanOrEqual(0.2);
  });

  it('interpolates between sampled frames', () => {
    const trajectory = simulate(makeInput(), VACUUM_CONFIGURATION);
    const time = trajectory.flightTime * 0.5;
    const point = pointAt(trajectory, time);

    expect(point).not.toBeNull();
    expect(Math.abs((point?.time ?? NaN) - time)).toBeLessThanOrEqual(0.0001);
    expect(point?.positionMeters.y ?? 0).toBeGreaterThan(0);
  });

  it('converges across reasonable time steps', () => {
    const coarse = { ...STANDARD_CONFIGURATION, timeStep: 1 / 60, constrainToTargetCarry: false };
    const fine = { ...coarse, timeStep: 1 / 240 };
    const input = makeInput();
    const coarseResult = simulate(input, coarse);
    const fineResult = simulate(input, fine);

    expect(Math.abs(coarseResult.carryMeters - fineResult.carryMeters)).toBeLessThanOrEqual(
      fineResult.carryMeters * 0.005,
    );
    expect(Math.abs(coarseResult.apexMeters - fineResult.apexMeters)).toBeLessThanOrEqual(0.15);
  });

  it('clamps sampling outside the flight window', () => {
    const trajectory = simulate(makeInput(), VACUUM_CONFIGURATION);

    expect(pointAt(trajectory, -1)?.time).toBe(trajectory.points[0].time);
    expect(pointAt(trajectory, trajectory.flightTime + 10)?.time).toBe(trajectory.flightTime);
  });

  it('leaves the flight unconstrained when the server reports no carry', () => {
    const withoutCarry = simulate(makeInput({ targetCarryMeters: 0 }));
    const unconstrained = simulate(makeInput(), { ...STANDARD_CONFIGURATION, constrainToTargetCarry: false });

    // A missing carry must not be invented -- the flight is simply not rescaled.
    expect(withoutCarry.carryMeters).toBeCloseTo(unconstrained.carryMeters, 6);
  });

  it('keeps wind out of the flight when there is none', () => {
    const still = simulate(makeInput({ spinAxisDegrees: 0, horizontalLaunchDegrees: 0 }));
    expect(Math.abs(still.lateralMeters)).toBeLessThan(0.001);
  });
});

// These pin the two deliberate deviations from the Swift original. Both exist because the
// ported behaviour produced a flight no golf shot looks like.
describe('arc shape', () => {
  it('rescales to the target carry without changing the shape of the shot', () => {
    const input = makeInput();
    const unconstrained = simulate(input, { ...STANDARD_CONFIGURATION, constrainToTargetCarry: false });
    const constrained = simulate(input);

    // The Swift original scaled x and z but not y, so this ratio moved when the flight was
    // rescaled -- squashing the trajectory. A rescale must move the landing point only.
    const rawRatio = unconstrained.apexMeters / unconstrained.carryMeters;
    const constrainedRatio = constrained.apexMeters / constrained.carryMeters;
    expect(constrainedRatio).toBeCloseTo(rawRatio, 3);
  });

  it('gives a driver a realistic apex relative to its carry', () => {
    // A real driver peaks at roughly 0.11-0.13 of its carry. The ported lift coefficients
    // produced 0.050, which reads as a line drive.
    const trajectory = simulate(
      makeInput({ ballSpeedMetersPerSecond: 67.7, launchAngleDegrees: 12.6, spinRPM: 2_380, targetCarryMeters: 241 }),
    );
    const ratio = trajectory.apexMeters / trajectory.carryMeters;

    expect(ratio).toBeGreaterThan(0.1);
    expect(ratio).toBeLessThan(0.14);
  });

  it('needs almost no rescaling, because the model now lands near the reported carry', () => {
    const input = makeInput({ ballSpeedMetersPerSecond: 67.7, launchAngleDegrees: 12.6, spinRPM: 2_380, targetCarryMeters: 241 });
    const unconstrained = simulate(input, { ...STANDARD_CONFIGURATION, constrainToTargetCarry: false });

    // Within 10%. A large correction here would mean the physics disagrees with the server
    // and the rescale is papering over it.
    expect(Math.abs(unconstrained.carryMeters - 241) / 241).toBeLessThan(0.1);
  });
});
