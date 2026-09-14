import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { darkPalette, lightPalette, type Palette } from './tokens';

export type Scheme = 'dark' | 'light';

// Follows the phone's appearance setting. The kiosk defaults to dark, so
// anything other than an explicit 'light' — including 'unspecified' and the
// null Appearance can report — resolves to dark.
export function resolveScheme(colorScheme: string | null | undefined): Scheme {
  return colorScheme === 'light' ? 'light' : 'dark';
}

export function useTheme(): { scheme: Scheme; colors: Palette } {
  const scheme = resolveScheme(useColorScheme());
  return { scheme, colors: scheme === 'light' ? lightPalette : darkPalette };
}

// Builds a component's styles from the active palette, rebuilding only when
// the scheme changes. Pass a module-level factory so the memo holds.
export function useThemedStyles<T>(factory: (colors: Palette) => T): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [factory, colors]);
}
