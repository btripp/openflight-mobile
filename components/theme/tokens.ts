// Colour tokens shared by every screen. The palettes mirror the kiosk's theme
// tokens (ui/src/index.css in open-flight/openflight) so the phone and the
// kiosk read as one product. Keep the two in step when the kiosk changes.

export interface Palette {
  bg: string;
  surface: string;
  // Accent as text or thin strokes. Fails contrast on the light background,
  // so light-theme text never uses it — see __tests__/theme.test.ts.
  accent: string;
  // Accent as a fill, with accentFg on top.
  accentBlock: string;
  accentFg: string;
  text: string;
  textMuted: string;
  // Non-text UI only (inactive icons, placeholders): passes 3:1, not 4.5:1.
  textFaint: string;
  border: string;
  borderSoft: string;
  danger: string;
  success: string;
  error: string;
  info: string;
  warning: string;
}

// index.css :root — shared by both themes.
const statusColors = {
  success: '#4ade80',
  error: '#ef4444',
  info: '#60a5fa',
  warning: '#fbbf24',
};

// index.css [data-theme='dark'] — the kiosk's default theme.
export const darkPalette: Palette = {
  bg: '#0e0f10',
  surface: '#16181a',
  accent: '#ffd400',
  accentBlock: '#ffd400',
  accentFg: '#0b0b0c',
  text: '#ffffff',
  textMuted: 'rgba(242, 241, 236, 0.78)',
  textFaint: 'rgba(242, 241, 236, 0.58)',
  border: 'rgba(242, 241, 236, 0.32)',
  borderSoft: 'rgba(242, 241, 236, 0.2)',
  danger: '#ff9b7d',
  ...statusColors,
};

// index.css [data-theme='light'].
export const lightPalette: Palette = {
  bg: '#f4f2ec',
  surface: '#f4f2ec',
  accent: '#ffbe1b',
  accentBlock: '#ffbe1b',
  accentFg: '#14140f',
  text: '#14140f',
  textMuted: 'rgba(20, 20, 15, 0.72)',
  textFaint: 'rgba(20, 20, 15, 0.52)',
  border: 'rgba(20, 20, 15, 0.28)',
  borderSoft: 'rgba(20, 20, 15, 0.16)',
  danger: '#b03a1a',
  ...statusColors,
};
