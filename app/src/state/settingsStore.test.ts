import { Appearance } from 'react-native';

import {
  createInMemoryPersistence,
  SETTINGS_KEYS,
  setSettingsPersistence,
  useSettingsStore,
} from './settingsStore';

type ColorScheme = 'light' | 'dark' | 'unspecified';
type AppearanceListener = (preferences: { colorScheme: ColorScheme }) => void;

let mockScheme: ColorScheme = 'light';
const mockListeners = new Set<AppearanceListener>();

/*
 * The react-native jest preset has no working native Appearance module, so
 * the scheme is mocked: `setColorScheme` updates the answer *and* notifies
 * change listeners, the way the platform does.  The `jest.mock` factory
 * itself may only reference `mock…`-prefixed names (babel-plugin-jest-hoist),
 * hence the indirection through the hoisted function declaration below.
 */
function mockAppearanceModule() {
  return {
    __esModule: true,
    getColorScheme: (): ColorScheme => mockScheme,
    setColorScheme: (next: ColorScheme): void => {
      mockScheme = next;
      mockListeners.forEach((listener) => listener({ colorScheme: next }));
    },
    addChangeListener: (listener: AppearanceListener) => {
      mockListeners.add(listener);
      return { remove: () => mockListeners.delete(listener) };
    },
  };
}

jest.mock('react-native/Libraries/Utilities/Appearance', () => mockAppearanceModule());

const store = () => useSettingsStore.getState();

let persistence: ReturnType<typeof createInMemoryPersistence>;

beforeEach(async () => {
  // A fresh default (in-memory) persistence for every test, then hydrate so
  // the state starts from what that persistence holds — the defaults.
  mockScheme = 'light';
  persistence = createInMemoryPersistence();
  setSettingsPersistence(persistence);
  await store().hydrate();
});

test('defaults match the web app when nothing is persisted', () => {
  expect(store().hydrated).toBe(true);
  expect(store().mode).toBe('system');
  expect(store().accent).toBe('#4CAF50');
  expect(store().font).toBe('alexandria');
  expect(store().adaptiveAccent).toBe(false);
});

test('setters write raw strings through the persistence, and hydrate reads them back', async () => {
  store().setAccent('#2196F3');
  store().setAdaptiveAccent(true);
  store().setMode('dark');
  store().setFont('cairo');

  // Raw strings exactly as the web app stores them ('0'/'1' for the boolean).
  expect(await persistence.get(SETTINGS_KEYS.accent)).toBe('#2196F3');
  expect(await persistence.get(SETTINGS_KEYS.adaptiveAccent)).toBe('1');
  expect(await persistence.get(SETTINGS_KEYS.mode)).toBe('dark');
  expect(await persistence.get(SETTINGS_KEYS.font)).toBe('cairo');

  // Round-trip: clobber the live state, then re-hydrate from persistence.
  useSettingsStore.setState({
    accent: '#4CAF50',
    adaptiveAccent: false,
    mode: 'system',
    font: 'alexandria',
  });
  await store().hydrate();

  expect(store().accent).toBe('#2196F3');
  expect(store().adaptiveAccent).toBe(true);
  expect(store().mode).toBe('dark');
  expect(store().font).toBe('cairo');

  // …and switching adaptive back off persists '0' like the web app does.
  store().setAdaptiveAccent(false);
  expect(await persistence.get(SETTINGS_KEYS.adaptiveAccent)).toBe('0');
});

test("resolved follows the system scheme while mode is 'system'", () => {
  expect(store().mode).toBe('system');
  expect(store().resolved).toBe('light');

  Appearance.setColorScheme('dark');
  expect(store().resolved).toBe('dark');

  // An explicit mode wins over the system preference, like the web app.
  store().setMode('light');
  expect(store().resolved).toBe('light');

  Appearance.setColorScheme('light');
  store().setMode('dark');
  expect(store().resolved).toBe('dark');
});
