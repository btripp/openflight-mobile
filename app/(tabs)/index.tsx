import {
  Keyboard,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSessionStore } from '../../stores/useSessionStore';
import { ConnectionBar } from '../../components/ConnectionBar';
import { CurrentShotView } from '../../components/CurrentShotView';
import { fontFamily } from '../../components/theme/fonts';
import { radius, spacing, type Palette } from '../../components/theme/tokens';
import { useTheme, useThemedStyles } from '../../components/theme/useTheme';

// Live view: connection controls + the latest shot. Shots are stored
// newest-first, so index 0 is the most recent.
export default function LiveScreen() {
  const latestShot = useSessionStore((s) => s.shots[0] ?? null);
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Tapping any non-interactive area dismisses the keyboard -- RN does not
          do this by default, so the URL field's keyboard would otherwise stay
          open until the return key is pressed. */}
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.inner}>
          <ConnectionBar />
          <CurrentShotView shot={latestShot} />
          <TouchableOpacity
            style={styles.rangeLink}
            onPress={() => router.push('/range')}
            accessibilityRole="button"
            accessibilityLabel="Open the driving range"
          >
            <Ionicons name="golf-outline" size={20} color={colors.accentFg} />
            <Text style={styles.rangeLinkLabel}>Driving range</Text>
          </TouchableOpacity>
        </View>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: c.bg,
    },
    inner: {
      flex: 1,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
    },
    rangeLink: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      // Comfortably past the 44pt minimum touch target.
      minHeight: 48,
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.lg,
      borderRadius: radius.control,
      backgroundColor: c.accentBlock,
    },
    rangeLinkLabel: {
      color: c.accentFg,
      fontFamily: fontFamily.semibold,
      fontSize: 16,
    },
  });
