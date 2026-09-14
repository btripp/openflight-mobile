import appJson from '../app.json';
import { darkPalette, lightPalette } from '../components/theme/tokens';

// FontGate holds the native splash while Outfit loads, so the splash has to
// match the first screen or a cold launch flashes the plugin's white default.
function splashProps() {
  const entry = appJson.expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
  );
  if (!Array.isArray(entry)) throw new Error('expo-splash-screen plugin has no config');
  return entry[1] as {
    image?: string;
    backgroundColor?: string;
    dark?: { backgroundColor?: string };
  };
}

describe('native splash', () => {
  it('uses the light theme background in light mode', () => {
    expect(splashProps().backgroundColor).toBe(lightPalette.bg);
  });

  it('uses the dark theme background in dark mode', () => {
    expect(splashProps().dark?.backgroundColor).toBe(darkPalette.bg);
  });

  // expo-splash-screen only applies the background to the iOS storyboard, and
  // only generates the Android splash drawable, when an image is set. Colours
  // without one are ignored on iOS and fail the Android resource build.
  it('sets an image that exists, which the colours depend on', () => {
    const { image } = splashProps();
    expect(image).toMatch(/^\.\//);
    // app.json paths are relative to the project root, one level above this file.
    expect(() => jest.requireActual(`.${image}`)).not.toThrow();
  });
});
