import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fontFamily } from '../../components/theme/fonts';
import { useTheme } from '../../components/theme/useTheme';

// Bottom tab bar. Live is the fully-featured Phase 0 screen; Shots, Stats, and
// Device are placeholders that later roadmap phases fill in. The selected tab
// switches to its filled icon, so it never relies on colour alone.
export default function TabsLayout() {
  const { colors } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accentText,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.borderSoft },
        tabBarLabelStyle: { fontFamily: fontFamily.medium },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Live',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'radio' : 'radio-outline'} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="shots"
        options={{
          title: 'Shots',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'list' : 'list-outline'} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: 'Stats',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons
              name={focused ? 'stats-chart' : 'stats-chart-outline'}
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="device"
        options={{
          title: 'Device',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons
              name={focused ? 'hardware-chip' : 'hardware-chip-outline'}
              color={color}
              size={size}
            />
          ),
        }}
      />
    </Tabs>
  );
}
