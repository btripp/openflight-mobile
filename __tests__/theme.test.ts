import { renderHook } from '@testing-library/react-native';
import { darkPalette, lightPalette, type Palette } from '../components/theme/tokens';
import { resolveScheme, useTheme } from '../components/theme/useTheme';

let mockColorScheme: string | null = 'dark';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockColorScheme,
}));

type Rgb = [number, number, number];

// Parses '#rrggbb' or 'rgba(r, g, b, a)', compositing any alpha over `ground`
// the way the screen will actually paint it.
function toRgb(color: string, ground: Rgb = [0, 0, 0]): Rgb {
  if (color.startsWith('#')) {
    return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)) as Rgb;
  }
  const [r, g, b, a] = color.match(/[\d.]+/g)!.map(Number);
  return [r, g, b].map((c, i) => c * a + ground[i] * (1 - a)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

// WCAG 2.x contrast ratio of `fg` painted on `bg`.
function contrast(fg: string, bg: string): number {
  const ground = toRgb(bg);
  const [hi, lo] = [luminance(toRgb(fg, ground)), luminance(ground)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

describe('resolveScheme', () => {
  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
    ['unspecified', 'dark'],
    [null, 'dark'],
    [undefined, 'dark'],
  ])('resolves %p to %p', (input, expected) => {
    expect(resolveScheme(input)).toBe(expected);
  });
});

describe('useTheme', () => {
  it('uses the light palette when the phone is in light mode', async () => {
    mockColorScheme = 'light';
    const { result } = await renderHook(() => useTheme());
    expect(result.current).toEqual({ scheme: 'light', colors: lightPalette });
  });

  it('uses the dark palette when the phone is in dark mode', async () => {
    mockColorScheme = 'dark';
    const { result } = await renderHook(() => useTheme());
    expect(result.current).toEqual({ scheme: 'dark', colors: darkPalette });
  });

  it('falls back to dark when the phone reports no preference', async () => {
    mockColorScheme = null;
    const { result } = await renderHook(() => useTheme());
    expect(result.current.scheme).toBe('dark');
  });
});

describe.each<[string, Palette]>([
  ['dark', darkPalette],
  ['light', lightPalette],
])('%s palette contrast (WCAG AA)', (_name, p) => {
  it.each(['bg', 'surface'] as const)('keeps body and error text readable on %s', (ground) => {
    expect(contrast(p.text, p[ground])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.textMuted, p[ground])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.danger, p[ground])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['bg', 'surface'] as const)('keeps accent-coloured text readable on %s', (ground) => {
    expect(contrast(p.accentText, p[ground])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['bg', 'surface'] as const)('keeps faint UI marks visible on %s', (ground) => {
    expect(contrast(p.textFaint, p[ground])).toBeGreaterThanOrEqual(3);
  });

  it('keeps text on an accent fill readable', () => {
    expect(contrast(p.accentFg, p.accentBlock)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('accent as text', () => {
  it('is readable on the dark background', () => {
    expect(contrast(darkPalette.accent, darkPalette.bg)).toBeGreaterThanOrEqual(4.5);
  });

  // The kiosk uses its accent as label text in light theme too. On mobile the
  // light accent is a fill only, because as text it is unreadable.
  it('is unreadable on the light background, so light theme uses it as a fill only', () => {
    expect(contrast(lightPalette.accent, lightPalette.bg)).toBeLessThan(3);
  });
});
