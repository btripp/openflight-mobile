import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { FontGate } from '../components/theme/FontGate';

// Keep the native splash up until FontGate has the brand font ready.
void SplashScreen.preventAutoHideAsync();

// Root layout. The tab navigator owns all screens; the root is a headerless
// Stack so the tabs render edge-to-edge. Connection/session state is held in the
// store and driven by the socket service, so it survives tab switches without
// any provider here.
export default function RootLayout() {
  return (
    <FontGate>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        {/* Pushed from Live. Headered so there is a back affordance; the tabs stay headerless. */}
        <Stack.Screen name="range" options={{ headerShown: true, title: 'Driving range' }} />
      </Stack>
      <StatusBar style="auto" />
    </FontGate>
  );
}
