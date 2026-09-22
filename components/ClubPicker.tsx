import { useState } from 'react';
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CLUBS_BY_TYPE, getClubName } from '../data/clubs';
import { socketService } from '../services/socket';
import { useSessionStore } from '../stores/useSessionStore';
import { fontFamily } from './theme/fonts';
import { radius, spacing, type Palette } from './theme/tokens';
import { useThemedStyles } from './theme/useTheme';

// On iOS the page sheet already sits below the status bar, so only the home
// indicator needs clearing; Android's modal is full-screen and needs both.
const SHEET_EDGES = Platform.OS === 'ios' ? (['bottom'] as const) : (['top', 'bottom'] as const);

// The club shots are being filed under, and the list to change it. Shows what
// the server last reported rather than the last tap: the server ignores a club
// it does not recognise without replying, so only its confirmation is truth.
export function ClubPicker() {
  const club = useSessionStore((s) => s.club);
  const isConnected = useSessionStore((s) => s.connectionState === 'connected');
  const styles = useThemedStyles(createStyles);
  const [open, setOpen] = useState(false);

  // A pick made while disconnected is never sent, so the list closes with the
  // connection rather than offering choices that would silently go nowhere —
  // and stays closed when the connection returns.
  if (open && !isConnected) setOpen(false);

  const clubName = club === null ? null : getClubName(club);

  const pick = (clubId: string) => {
    socketService.setClub(clubId);
    setOpen(false);
  };

  return (
    <>
      <TouchableOpacity
        style={[styles.trigger, !isConnected && styles.triggerDisabled]}
        onPress={() => setOpen(true)}
        disabled={!isConnected}
        accessibilityRole="button"
        accessibilityLabel={`Club: ${clubName ?? 'not set'}. Change club`}
        accessibilityState={{ disabled: !isConnected }}
      >
        <Text style={styles.triggerLabel}>Club</Text>
        <Text style={styles.triggerValue} numberOfLines={1}>
          {clubName ?? 'Not set'}
        </Text>
        <Text style={styles.triggerAction}>Change</Text>
      </TouchableOpacity>

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <SafeAreaView style={styles.sheet} edges={SHEET_EDGES}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} accessibilityRole="header">
              Select club
            </Text>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close club list"
            >
              <Text style={styles.closeButtonText}>Done</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.sheetBody}>
            {Object.entries(CLUBS_BY_TYPE).map(([type, clubs]) => (
              <View key={type} style={styles.section}>
                <Text style={styles.sectionTitle} accessibilityRole="header">
                  {type}
                </Text>
                <View style={styles.grid}>
                  {clubs.map((option) => {
                    const selected = option.id === club;
                    return (
                      <TouchableOpacity
                        key={option.id}
                        style={[styles.tile, selected && styles.tileSelected]}
                        onPress={() => pick(option.id)}
                        accessibilityRole="button"
                        accessibilityLabel={option.name}
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.tileText, selected && styles.tileTextSelected]}>
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    trigger: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: 44,
      marginTop: spacing.sm,
      paddingHorizontal: spacing.md,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.control,
      backgroundColor: c.surface,
    },
    triggerDisabled: {
      opacity: 0.5,
    },
    triggerLabel: {
      color: c.textMuted,
      fontFamily: fontFamily.medium,
      fontSize: 13,
    },
    triggerValue: {
      flex: 1,
      color: c.text,
      fontFamily: fontFamily.semibold,
      fontSize: 15,
    },
    triggerAction: {
      color: c.accentText,
      fontFamily: fontFamily.semibold,
      fontSize: 13,
    },
    sheet: {
      flex: 1,
      backgroundColor: c.bg,
    },
    sheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.borderSoft,
    },
    sheetTitle: {
      color: c.text,
      fontFamily: fontFamily.bold,
      fontSize: 20,
    },
    closeButton: {
      minHeight: 44,
      minWidth: 44,
      justifyContent: 'center',
      alignItems: 'flex-end',
    },
    closeButtonText: {
      color: c.accentText,
      fontFamily: fontFamily.semibold,
      fontSize: 16,
    },
    sheetBody: {
      padding: spacing.lg,
      gap: spacing.xl,
    },
    section: {
      gap: spacing.sm,
    },
    sectionTitle: {
      color: c.textMuted,
      fontFamily: fontFamily.semibold,
      fontSize: 13,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    tile: {
      minWidth: 64,
      minHeight: 48,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.control,
      backgroundColor: c.surface,
    },
    tileSelected: {
      backgroundColor: c.accentBlock,
      borderColor: c.accentBlock,
    },
    tileText: {
      color: c.text,
      fontFamily: fontFamily.semibold,
      fontSize: 16,
    },
    tileTextSelected: {
      color: c.accentFg,
    },
  });
