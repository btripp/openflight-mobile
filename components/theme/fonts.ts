import { Outfit_400Regular } from '@expo-google-fonts/outfit/400Regular';
import { Outfit_500Medium } from '@expo-google-fonts/outfit/500Medium';
import { Outfit_600SemiBold } from '@expo-google-fonts/outfit/600SemiBold';
import { Outfit_700Bold } from '@expo-google-fonts/outfit/700Bold';

// Outfit is the kiosk's typeface (ui/src/index.css --font-body). Only the
// weights the app uses are imported, per weight, so the other five are not
// bundled.
export const fontFamily = {
  regular: 'Outfit_400Regular',
  medium: 'Outfit_500Medium',
  semibold: 'Outfit_600SemiBold',
  bold: 'Outfit_700Bold',
} as const;

export const fontAssets = {
  [fontFamily.regular]: Outfit_400Regular,
  [fontFamily.medium]: Outfit_500Medium,
  [fontFamily.semibold]: Outfit_600SemiBold,
  [fontFamily.bold]: Outfit_700Bold,
};
