import { StyleSheet, Text, View } from 'react-native';
import type { AngleQuality, SpinQuality } from '../types';
import { fontFamily } from './theme/fonts';
import { radius, spacing, type Palette } from './theme/tokens';
import { useThemedStyles } from './theme/useTheme';

type TileVariant = 'primary' | 'secondary' | 'spin';

interface MetricTileProps {
  value: string | number;
  unit?: string;
  label: string;
  subtext?: string;
  variant?: TileVariant;
  // 'low' | 'medium' | 'high' render 1/2/3 filled dots; 'experimental' shows the
  // label only (no dots), matching the web ShotDisplay behavior.
  confidence?: AngleQuality | SpinQuality | null;
}

const FILLED_DOTS: Record<string, number> = { low: 1, medium: 2, high: 3 };

export function MetricTile({
  value,
  unit,
  label,
  subtext,
  variant = 'secondary',
  confidence,
}: MetricTileProps) {
  const styles = useThemedStyles(createStyles);
  const filled = confidence ? (FILLED_DOTS[confidence] ?? 0) : 0;

  return (
    <View style={[styles.tile, variant === 'primary' && styles.tilePrimary]}>
      <View style={styles.valueRow}>
        <Text style={[styles.value, variant === 'primary' && styles.valuePrimary]}>{value}</Text>
        {unit ? <Text style={styles.unit}>{unit}</Text> : null}
      </View>
      <Text style={styles.label}>{label}</Text>
      {subtext ? <Text style={styles.subtext}>{subtext}</Text> : null}
      {confidence ? (
        <View style={styles.confidenceRow}>
          {filled > 0 ? (
            <View style={styles.dots}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={[styles.dot, i < filled && styles.dotFilled]} />
              ))}
            </View>
          ) : null}
          <Text style={styles.confidenceLabel}>{confidence}</Text>
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    tile: {
      width: '48%',
      backgroundColor: c.surface,
      borderRadius: radius.card,
      padding: 14,
      marginBottom: spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    // The kiosk marks its promoted card with an accent rule on the leading edge.
    tilePrimary: {
      borderLeftWidth: 4,
      borderLeftColor: c.accentBlock,
    },
    valueRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: spacing.xs,
    },
    value: {
      fontSize: 26,
      fontFamily: fontFamily.bold,
      fontVariant: ['tabular-nums'],
      color: c.text,
    },
    valuePrimary: {
      color: c.accentText,
    },
    unit: {
      fontSize: 13,
      fontFamily: fontFamily.medium,
      color: c.textMuted,
    },
    label: {
      marginTop: spacing.xs,
      fontSize: 11,
      fontFamily: fontFamily.semibold,
      color: c.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    subtext: {
      marginTop: 2,
      fontSize: 11,
      fontFamily: fontFamily.regular,
      color: c.textMuted,
    },
    confidenceRow: {
      marginTop: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    dots: {
      flexDirection: 'row',
      gap: 3,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: c.border,
    },
    dotFilled: {
      backgroundColor: c.accentText,
    },
    confidenceLabel: {
      fontSize: 10,
      fontFamily: fontFamily.medium,
      color: c.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
  });
