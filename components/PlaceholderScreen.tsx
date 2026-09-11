import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fontFamily } from './theme/fonts';
import type { Palette } from './theme/tokens';
import { useThemedStyles } from './theme/useTheme';

// Shared empty-state for tabs whose features land in a later roadmap phase.
// Keeps the three placeholder screens from duplicating layout/styling.
export function PlaceholderScreen({ title, subtitle }: { title: string; subtitle: string }) {
  const styles = useThemedStyles(createStyles);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.center}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
    </SafeAreaView>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: c.bg,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
    },
    title: {
      fontSize: 22,
      fontFamily: fontFamily.bold,
      color: c.text,
    },
    subtitle: {
      marginTop: 8,
      fontSize: 14,
      fontFamily: fontFamily.regular,
      color: c.textMuted,
      textAlign: 'center',
    },
  });
