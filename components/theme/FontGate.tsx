import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, type ReactNode } from 'react';
import { fontAssets } from './fonts';

// Holds the app behind the native splash until Outfit has loaded, then hides
// the splash. A failed load must not strand the user on the splash, so an
// error also lets the app through — text falls back to the system font.
export function FontGate({ children }: { children: ReactNode }) {
  const [loaded, error] = useFonts(fontAssets);
  const ready = loaded || error !== null;

  useEffect(() => {
    if (error) console.warn('Outfit failed to load; using the system font.', error);
  }, [error]);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  return ready ? children : null;
}
