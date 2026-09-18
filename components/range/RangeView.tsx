// The driving-range view: a real ball flight from the ported simulator, drawn with
// three.js's WebGPU renderer on a react-native-webgpu surface.
//
// Renderer history, so nobody repeats it: expo-gl was tried first and does NOT work here. It
// serves a WebGL 1 context (three dropped WebGL 1 at r163) and, more fatally, it presents the
// FIRST frame and then never updates on Expo SDK 57 / RN 0.86.3 New Architecture -- verified
// by hashing successive screenshots. Its on-screen FPS counter keeps reporting the last value
// after presentation dies, which makes a frozen view look healthy. Always verify animation by
// comparing frames, never by eye.
//
// Scene shape mirrors the RealityKit original: a FIXED camera (it never follows the ball),
// distance markers with no text labels, and a tracer behind the ball. One world unit = one
// metre, so the simulator's output is used directly.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Canvas, useCanvasRef, useDevice } from 'react-native-webgpu';
import { fontFamily } from '../theme/fonts';
import { useSessionStore } from '../../stores/useSessionStore';
import { socketService } from '../../services/socket';
import * as THREE from 'three/webgpu';
import { simulate } from '../../range/ballFlightSimulator';
import { flightInputFromShot } from '../../range/flightInput';
import { playbackDuration, pointAt, type FlightTrajectory } from '../../range/flightModels';
import type { Shot } from '../../types';

const MARKER_SPACING_METRES = 25;
const MARKER_ROWS = 12;
const BAND_COUNT = 26;
// Pause on the landed ball before looping, so the end of the flight is readable.
const HOLD_SECONDS = 1.5;
const METRES_TO_YARDS = 1.09361;
// The ported playbackDuration() holds a shot on screen for 3.5-6s, which feels sluggish when
// the flight loops. Kept as the source of truth and scaled here -- a presentation decision,
// not a change to the domain model.
const PLAYBACK_SPEED = 2.2;

// A real ball is 0.021m and would be a couple of pixels at 240m, so it is drawn well over
// life size. These were set when the lens was 50 deg; narrowing it to 33 deg magnified
// everything, so they came down again. The ball stays roughly twice the tracer's width --
// that ratio is what makes it read as a ball leading a trail rather than a blob on a rope.
const BALL_RADIUS_SCENE = 1.0;
const TRACER_RADIUS_SCENE = 0.45;
const TUBE_SEGMENTS = 220;
const TUBE_RADIAL = 8;

// The simulator's downrange axis is +Z (BallFlightSimulator sets velocity.z to
// horizontalSpeed * cos(horizontal), which is positive). three's camera looks down -Z, so
// every simulator position is mirrored on Z on the way in. Getting this wrong sends the ball
// behind the camera, which looks exactly like a stuck animation.
const toSceneZ = (z: number) => -z;

// Flown only when the session has produced no shots yet, so the range is never an empty
// screen. It is labelled DEMO on screen -- AGENTS.md forbids presenting invented numbers as
// if they were measured.
const DEMO_SHOT: Shot = {
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
  launch_angle_horizontal: 6,
  launch_angle_confidence: 0.9,
  angle_source: 'radar',
  club_angle_deg: null,
  club_path_deg: 4.5,
  spin_axis_deg: -14,  // peaks ~7m right, finishes ~4m left: a push draw
  spin_rpm: 2380,
  spin_source: 'measured',
  spin_quality: 'high',
};

export function RangeView() {
  const ref = useCanvasRef();
  const { device } = useDevice();
  // Focused selectors, per AGENTS.md -- the range never opens a transport itself; the socket
  // service is the only writer and this reads what it produced.
  const latestShot = useSessionStore((s) => s.shots[0] ?? null);
  const isConnected = useSessionStore((s) => s.connectionState === 'connected');

  const shot = latestShot ?? DEMO_SHOT;
  const isDemo = latestShot === null;
  const [fps, setFps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ carry: number; apex: number } | null>(null);
  const replayRef = useRef<(() => void) | null>(null);
  // Set once the GL scene exists; until then an arriving shot waits in pendingShotRef so a
  // shot that lands mid-initialisation is not dropped.
  const loadShotRef = useRef<((s: Shot) => void) | null>(null);
  const pendingShotRef = useRef<Shot | null>(null);

  useEffect(() => {
    const next = latestShot ?? DEMO_SHOT;
    if (loadShotRef.current) loadShotRef.current(next);
    else pendingShotRef.current = next;
  }, [latestShot]);

  useEffect(() => {
    if (!device) return;
    const canvas = ref.current;
    if (!canvas) return;

    let frame = 0;
    let disposed = false;

    (async () => {
      try {
        const context = canvas.getContext('webgpu');
        if (!context) throw new Error('no webgpu context');
        const surface = canvas.getNativeSurface();
        const width = surface.width;
        const height = surface.height;

        const renderer = new THREE.WebGPURenderer({
          canvas: surface as unknown as HTMLCanvasElement,
          context: context as unknown as GPUCanvasContext,
          device,
          antialias: true,
        });
        await renderer.init();

        const scene = new THREE.Scene();

        // Vertical sky gradient, deep overhead fading to haze at the horizon. Built as a
        // 1-pixel-wide DataTexture rather than a shader so it costs nothing and reads the
        // same on both backends.
        const SKY_TOP = new THREE.Color(0x2f6ea8);
        const SKY_HORIZON = new THREE.Color(0xc2dcee);
        const steps = 64;
        const skyData = new Uint8Array(steps * 4);
        for (let i = 0; i < steps; i++) {
          // Row 0 is the bottom of the texture, so the horizon colour goes first.
          const c = SKY_HORIZON.clone().lerp(SKY_TOP, i / (steps - 1));
          skyData[i * 4 + 0] = Math.round(c.r * 255);
          skyData[i * 4 + 1] = Math.round(c.g * 255);
          skyData[i * 4 + 2] = Math.round(c.b * 255);
          skyData[i * 4 + 3] = 255;
        }
        const skyTexture = new THREE.DataTexture(skyData, 1, steps);
        skyTexture.needsUpdate = true;
        scene.background = skyTexture;
        // Fog tinted to the horizon haze so distant ground dissolves into the sky rather
        // than ending on a hard line.
        scene.fog = new THREE.Fog(SKY_HORIZON.getHex(), 620, 1800);

        // Fixed pose, framing the whole carry. The original never follows the ball.
        const camera = new THREE.PerspectiveCamera(33, width / height, 1, 2200);
        camera.position.set(0, 12, 58);
        camera.lookAt(0, 30, -150);

        // --- Ground -------------------------------------------------------------------
        // One contiguous run of alternating bands plus a wide apron. Nothing is coplanar,
        // which matters: overlapping ground geometry loses depth fights at range.
        const apron = new THREE.Mesh(
          new THREE.PlaneGeometry(2400, 900),
          new THREE.MeshBasicMaterial({ color: 0x8fbf72 }),
        );
        apron.rotation.x = -Math.PI / 2;
        apron.position.set(0, -0.5, -260);
        scene.add(apron);

        // Low contrast on purpose -- the reference reads as mown turf, not a striped pitch.
        const bandColours = [0x96c479, 0x9ecb80];
        for (let i = 0; i < BAND_COUNT; i++) {
          const band = new THREE.Mesh(
            new THREE.PlaneGeometry(320, MARKER_SPACING_METRES),
            new THREE.MeshBasicMaterial({ color: bandColours[i % 2] }),
          );
          band.rotation.x = -Math.PI / 2;
          band.position.set(
            0,
            0,
            MARKER_SPACING_METRES - i * MARKER_SPACING_METRES - MARKER_SPACING_METRES / 2,
          );
          scene.add(band);
        }

        // --- Horizon ------------------------------------------------------------------
        // Rolling hills: flattened spheres in a muted, desaturated green so they read as
        // distance rather than as objects.
        const hillGeometry = new THREE.SphereGeometry(1, 16, 8);
        const hillMaterial = new THREE.MeshBasicMaterial({ color: 0x7fae6a });
        const hills: [number, number, number, number][] = [
          [-360, -900, 230, 66],
          [-80, -980, 290, 84],
          [220, -920, 250, 72],
          [520, -860, 200, 56],
          [-640, -870, 190, 52],
        ];
        for (const [x, z, radius, rise] of hills) {
          const hill = new THREE.Mesh(hillGeometry, hillMaterial);
          hill.position.set(x, -4, z);
          hill.scale.set(radius, rise, radius * 0.6);
          scene.add(hill);
        }

        // Tree line down both sides. Instanced -- two draw calls for the whole treeline.
        const SIDE_TREES = 40;
        const BACK_TREES = 34;
        const TREE_COUNT = SIDE_TREES + BACK_TREES;
        const canopies = new THREE.InstancedMesh(
          new THREE.SphereGeometry(1, 10, 8),
          new THREE.MeshBasicMaterial({ color: 0x4f8f56 }),
          TREE_COUNT,
        );
        const trunks = new THREE.InstancedMesh(
          new THREE.CylinderGeometry(1, 1, 1, 6),
          new THREE.MeshBasicMaterial({ color: 0x7a5a3c }),
          TREE_COUNT,
        );
        const treeDummy = new THREE.Object3D();
        for (let i = 0; i < TREE_COUNT; i++) {
          // Deterministic jitter so neither row looks like a fence.
          const wobble = Math.sin(i * 12.9898) * 0.5 + 0.5;
          let x: number;
          let z: number;
          if (i < SIDE_TREES) {
            // Flanking rows, set back from the landing corridor.
            const side = i % 2 === 0 ? -1 : 1;
            const row = Math.floor(i / 2);
            x = side * (85 + wobble * 70);
            z = -120 - row * 26 - wobble * 20;
          } else {
            // Back row across the full width, sitting on the horizon behind the range.
            const k = i - SIDE_TREES;
            x = -380 + (k / (BACK_TREES - 1)) * 760 + (wobble - 0.5) * 26;
            z = -430 - wobble * 60;
          }
          const h = 11 + wobble * 8;

          treeDummy.position.set(x, h * 0.55 + h * 0.5, z);
          treeDummy.scale.set(h * 0.55, h * 0.62, h * 0.55);
          treeDummy.updateMatrix();
          canopies.setMatrixAt(i, treeDummy.matrix);

          treeDummy.position.set(x, h * 0.28, z);
          treeDummy.scale.set(h * 0.09, h * 0.56, h * 0.09);
          treeDummy.updateMatrix();
          trunks.setMatrixAt(i, treeDummy.matrix);
        }
        canopies.instanceMatrix.needsUpdate = true;
        trunks.instanceMatrix.needsUpdate = true;
        scene.add(trunks);
        scene.add(canopies);

        // --- Flight -------------------------------------------------------------------
        // Distance markers, kept small and low-contrast: the reference uses the treeline for
        // depth, so these only need to hint at yardage.
        const markerGeometry = new THREE.BoxGeometry(2, 1.2, 2);
        const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xf4f6f0 });
        for (let i = 1; i <= MARKER_ROWS; i++) {
          for (const side of [-46, 46]) {
            const marker = new THREE.Mesh(markerGeometry, markerMaterial);
            marker.position.set(side, 0.6, -i * MARKER_SPACING_METRES);
            scene.add(marker);
          }
        }

        // --- Shot loading -------------------------------------------------------------
        // Everything below is rebuilt per shot. The GL context, scene, camera and scenery
        // are NOT -- a new shot must never cost a context, which is expensive and, on this
        // stack, historically fragile.
        let trajectory: FlightTrajectory | null = null;
        let duration = 1;
        let cumulative: number[] = [0];
        let totalLength = 1;
        let tracerIndexCount = 0;

        const tracer = new THREE.Mesh(
          new THREE.BufferGeometry(),
          new THREE.MeshBasicMaterial({ color: 0x2f6df0 }),
        );
        scene.add(tracer);

        const ball = new THREE.Mesh(
          new THREE.SphereGeometry(BALL_RADIUS_SCENE, 16, 16),
          new THREE.MeshBasicMaterial({ color: 0xffffff }),
        );
        scene.add(ball);

        const loadShot = (incoming: Shot) => {
          const next = simulate(flightInputFromShot(incoming, String(incoming.shot_number ?? 'demo')));
          trajectory = next;
          duration = playbackDuration(next) / PLAYBACK_SPEED;

          // Cumulative distance along the flight, so the trail can be revealed in the same
          // units TubeGeometry is built in -- see the reveal in animate().
          cumulative = [0];
          for (let i = 1; i < next.points.length; i++) {
            const a = next.points[i - 1].positionMeters;
            const b = next.points[i].positionMeters;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dz = b.z - a.z;
            cumulative.push(cumulative[i - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz));
          }
          totalLength = cumulative[cumulative.length - 1] || 1;

          const curve = new THREE.CatmullRomCurve3(
            next.points.map(
              (pt) =>
                new THREE.Vector3(
                  pt.positionMeters.x,
                  pt.positionMeters.y + BALL_RADIUS_SCENE,
                  toSceneZ(pt.positionMeters.z),
                ),
            ),
          );
          // three does not free GPU buffers on its own, so the previous shot's tube is
          // disposed explicitly. Leaks here are this port's characteristic failure mode.
          tracer.geometry.dispose();
          tracer.geometry = new THREE.TubeGeometry(
            curve,
            TUBE_SEGMENTS,
            TRACER_RADIUS_SCENE,
            TUBE_RADIAL,
            false,
          );
          tracerIndexCount = TUBE_SEGMENTS * TUBE_RADIAL * 6;
          tracer.geometry.setDrawRange(0, 0);

          elapsed = 0;
          setSummary({
            carry: next.carryMeters * METRES_TO_YARDS,
            apex: next.apexMeters * METRES_TO_YARDS,
          });
        };

        // Distance travelled at a flight time, matching pointAt's interpolation so the ball
        // and the end of the trail are always in the same place.
        const distanceAtTime = (t: number) => {
          if (!trajectory) return 0;
          const pts = trajectory.points;
          if (t <= pts[0].time) return 0;
          if (t >= pts[pts.length - 1].time) return totalLength;
          let lower = 0;
          let upper = pts.length - 1;
          while (upper - lower > 1) {
            const mid = Math.floor((lower + upper) / 2);
            if (pts[mid].time <= t) lower = mid;
            else upper = mid;
          }
          const span = pts[upper].time - pts[lower].time;
          const f = span > 0 ? (t - pts[lower].time) / span : 0;
          return cumulative[lower] + (cumulative[upper] - cumulative[lower]) * f;
        };

        const dummy = new THREE.Object3D();
        let elapsed = 0;
        let last = Date.now();
        let frames = 0;
        let since = 0;

        replayRef.current = () => {
          elapsed = 0;
        };
        loadShotRef.current = loadShot;
        loadShot(pendingShotRef.current ?? DEMO_SHOT);

        const animate = async () => {
          if (disposed) return;
          if (!trajectory) {
            frame = requestAnimationFrame(() => void animate());
            return;
          }
          const now = Date.now();
          const delta = Math.min((now - last) / 1000, 0.1);
          last = now;

          elapsed += delta;
          if (elapsed > duration + HOLD_SECONDS) elapsed = 0;
          const progress = Math.min(elapsed / duration, 1);
          const flightTime = progress * trajectory.flightTime;

          const head = pointAt(trajectory, flightTime);
          if (head) {
            ball.position.set(
              head.positionMeters.x,
              head.positionMeters.y + BALL_RADIUS_SCENE,
              toSceneZ(head.positionMeters.z),
            );
          }

          // Reveal the tube up to the ball, by distance rather than by time -- see
          // distanceAtTime. Rounded to whole triangles so no partial primitive is submitted.
          const travelled = distanceAtTime(flightTime) / totalLength;
          const revealed = Math.floor((tracerIndexCount * travelled) / 6) * 6;
          tracer.geometry.setDrawRange(0, revealed);

          renderer.render(scene, camera);
          // Presenting is explicit on this surface; without it the frame never reaches screen.
          context.present();

          frames += 1;
          since += delta;
          if (since >= 1) {
            setFps(Math.round(frames / since));
            frames = 0;
            since = 0;
          }

          frame = requestAnimationFrame(() => void animate());
        };

        void animate();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
    };
  }, [device, ref]);

  // A field the shot did not carry renders as a dash. AGENTS.md forbids inventing a
  // measurement to make a tile look complete.
  const show = (v: number | null | undefined, digits = 1, suffix = '') =>
    v === null || v === undefined ? '—' : `${v.toFixed(digits)}${suffix}`;

  return (
    <View style={styles.root}>
      <Canvas ref={ref} style={StyleSheet.absoluteFill} />

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.error}>The range can&apos;t draw: {error}</Text>
        </View>
      ) : (
        <>
          {isDemo ? (
            <View style={styles.demoBadge} pointerEvents="none">
              <Text style={styles.demoBadgeText}>DEMO SHOT — no shots in this session yet</Text>
            </View>
          ) : null}

          <View style={styles.headline} pointerEvents="none">
            <View style={styles.headlineTile}>
              <Text style={styles.tileLabel}>BALL SPEED</Text>
              <Text style={styles.tileBig}>
                {shot.ball_speed_mph.toFixed(1)}
                <Text style={styles.tileUnit}> MPH</Text>
              </Text>
            </View>
            <View style={styles.headlineTile}>
              <Text style={styles.tileLabel}>CARRY</Text>
              <Text style={styles.tileBig}>
                {summary ? summary.carry.toFixed(0) : '—'}
                <Text style={styles.tileUnit}> YDS</Text>
              </Text>
            </View>
          </View>

          <View style={styles.grid} pointerEvents="none">
            {(
              [
                ['CLUB SPEED', show(shot.club_speed_mph, 1), 'mph'],
                ['SMASH', show(shot.smash_factor, 2), ''],
                ['LAUNCH', show(shot.launch_angle_vertical, 1), '°'],
                ['SPIN', show(shot.spin_rpm, 0), 'rpm'],
                ['DIRECTION', show(shot.launch_angle_horizontal, 1), '°'],
                ['SPIN AXIS', show(shot.spin_axis_deg, 1), '°'],
                ['PATH', show(shot.club_path_deg, 1), '°'],
                ['APEX', summary ? summary.apex.toFixed(0) : '—', 'yds'],
              ] as const
            ).map(([label, value, unit]) => (
              <View key={label} style={styles.gridTile}>
                <Text style={styles.tileLabel}>{label}</Text>
                <Text style={styles.tileValue}>
                  {value}
                  {unit ? <Text style={styles.tileUnitSmall}> {unit}</Text> : null}
                </Text>
              </View>
            ))}
          </View>

          <Text style={styles.fps} pointerEvents="none">
            {fps} fps
          </Text>
        </>
      )}

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.replay}
          onPress={() => replayRef.current?.()}
          accessibilityRole="button"
          accessibilityLabel="Replay the shot"
        >
          <Text style={styles.replayLabel}>Replay</Text>
        </TouchableOpacity>
        {/* Only offered while connected -- the request goes to the Pi, so without a
            connection the button would look functional and silently do nothing. */}
        {isConnected ? (
          <TouchableOpacity
            style={styles.simulate}
            onPress={() => socketService.simulateShot()}
            accessibilityRole="button"
            accessibilityLabel="Simulate a shot"
          >
            <Text style={styles.simulateLabel}>Simulate shot</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const TILE_BG = 'rgba(17, 26, 38, 0.62)';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#2f6ea8' },
  headline: {
    position: 'absolute',
    top: 14,
    left: 16,
    right: 16,
    flexDirection: 'row',
    gap: 10,
  },
  headlineTile: {
    flex: 1,
    backgroundColor: TILE_BG,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  grid: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 96,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  gridTile: {
    // Two per row, accounting for the 6pt gap.
    width: '48%',
    flexGrow: 1,
    backgroundColor: TILE_BG,
    borderRadius: 9,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  tileLabel: {
    color: 'rgba(255,255,255,0.68)',
    fontFamily: fontFamily.medium,
    fontSize: 10,
    letterSpacing: 1.1,
  },
  tileBig: { color: '#ffffff', fontFamily: fontFamily.bold, fontSize: 24 },
  tileValue: { color: '#ffffff', fontFamily: fontFamily.semibold, fontSize: 15, marginTop: 0 },
  tileUnit: { color: 'rgba(255,255,255,0.72)', fontFamily: fontFamily.medium, fontSize: 12 },
  tileUnitSmall: { color: 'rgba(255,255,255,0.65)', fontFamily: fontFamily.medium, fontSize: 11 },
  fps: {
    position: 'absolute',
    top: 96,
    right: 18,
    color: 'rgba(255,255,255,0.75)',
    fontFamily: fontFamily.medium,
    fontSize: 11,
  },
  errorBox: { position: 'absolute', top: 80, left: 24, right: 24 },
  error: { color: '#ff9b7d', fontFamily: fontFamily.regular, fontSize: 14 },
  actions: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 36,
    flexDirection: 'row',
    gap: 10,
  },
  replay: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: 'rgba(17, 26, 38, 0.72)',
  },
  replayLabel: { color: '#ffffff', fontFamily: fontFamily.bold, fontSize: 16 },
  simulate: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#ffd400',
  },
  simulateLabel: { color: '#14140f', fontFamily: fontFamily.bold, fontSize: 16 },
  demoBadge: {
    position: 'absolute',
    top: 96,
    left: 16,
    backgroundColor: 'rgba(17, 26, 38, 0.62)',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  demoBadgeText: {
    color: 'rgba(255,255,255,0.82)',
    fontFamily: fontFamily.medium,
    fontSize: 11,
    letterSpacing: 0.4,
  },
});
