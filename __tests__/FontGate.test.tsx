import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { FontGate } from '../components/theme/FontGate';

let mockFontState: [boolean, Error | null] = [false, null];
jest.mock('expo-font', () => ({ useFonts: () => mockFontState }));
jest.mock('expo-splash-screen', () => ({ hideAsync: jest.fn(() => Promise.resolve()) }));

const { hideAsync: mockHideAsync } = jest.requireMock('expo-splash-screen') as {
  hideAsync: jest.Mock;
};

function renderGate() {
  return render(
    <FontGate>
      <Text>App content</Text>
    </FontGate>,
  );
}

beforeEach(() => {
  mockHideAsync.mockClear();
});

describe('FontGate', () => {
  it('keeps the splash up and renders nothing while fonts load', async () => {
    mockFontState = [false, null];
    await renderGate();
    expect(screen.queryByText('App content')).toBeNull();
    expect(mockHideAsync).not.toHaveBeenCalled();
  });

  it('renders the app and hides the splash once fonts load', async () => {
    mockFontState = [true, null];
    await renderGate();
    expect(screen.getByText('App content')).toBeTruthy();
    expect(mockHideAsync).toHaveBeenCalledTimes(1);
  });

  it('still renders the app and hides the splash when fonts fail to load', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const failure = new Error('font download failed');
    mockFontState = [false, failure];

    await renderGate();

    expect(screen.getByText('App content')).toBeTruthy();
    expect(mockHideAsync).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Outfit failed to load'), failure);
    warn.mockRestore();
  });
});
