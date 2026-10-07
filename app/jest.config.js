module.exports = {
  preset: 'react-native',
  passWithNoTests: true,
  testMatch: ['**/src/**/*.test.ts', '**/src/**/*.test.tsx'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|sql\\.js)/)',
  ],
  moduleNameMapper: {
    // native facades resolve to mockable test drivers under Jest
    '^\\.\\.?/.*/native/db$': '<rootDir>/src/test/mocks/dbDriver.ts',
    '^\\.\\.?/.*/native/fs$': '<rootDir>/src/test/mocks/fsDriver.ts',
    '^\\.\\.?/.*/native/audio$': '<rootDir>/src/test/mocks/audioDriver.ts',
    '^\\.\\.?/.*/native/tray$': '<rootDir>/src/test/mocks/trayDriver.ts',
  },
};
