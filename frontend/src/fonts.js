/**
 * Optional web fonts.
 *
 * A @font-face is only downloaded once something on the page actually uses
 * the family, so registering Cairo and Alexandria costs nothing until the
 * user picks one in Settings.  Latin *and* Arabic subsets are included so
 * both scripts render correctly with any selection.
 */

// Cairo — 400/500/600/700/800, latin + arabic
import '@fontsource/cairo/latin-400.css';
import '@fontsource/cairo/latin-500.css';
import '@fontsource/cairo/latin-600.css';
import '@fontsource/cairo/latin-700.css';
import '@fontsource/cairo/latin-800.css';
import '@fontsource/cairo/arabic-400.css';
import '@fontsource/cairo/arabic-500.css';
import '@fontsource/cairo/arabic-600.css';
import '@fontsource/cairo/arabic-700.css';
import '@fontsource/cairo/arabic-800.css';

// Alexandria — 400/500/600/700/800, latin + arabic
import '@fontsource/alexandria/latin-400.css';
import '@fontsource/alexandria/latin-500.css';
import '@fontsource/alexandria/latin-600.css';
import '@fontsource/alexandria/latin-700.css';
import '@fontsource/alexandria/latin-800.css';
import '@fontsource/alexandria/arabic-400.css';
import '@fontsource/alexandria/arabic-500.css';
import '@fontsource/alexandria/arabic-600.css';
import '@fontsource/alexandria/arabic-700.css';
import '@fontsource/alexandria/arabic-800.css';

export default null;
