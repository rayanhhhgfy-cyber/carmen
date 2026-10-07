const path = require('path');
module.exports = {
  project: { ios: {}, macos: {}, windows: {}, android: {} },
  assets: [path.join(__dirname, 'assets', 'fonts')],
  // local TurboModule packages (autolinking)
  dependencies: Object.fromEntries(
    ['samma3ni-db', 'samma3ni-fs', 'samma3ni-audio', 'samma3ni-tray'].map((name) => [
      name,
      { root: path.join(__dirname, 'modules', name) },
    ]),
  ),
};
