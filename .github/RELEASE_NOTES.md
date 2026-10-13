<!--
  Release body — the "what's new" section, appended by build.yml to the
  standard Downloads table (env RELEASE_BODY) on every tagged release.
  Update this file as the release takes shape; the tag names the version.
-->

### What's new

**Player**

- **Cinematic mode** (Settings → Appearance): desktop full screen drops every
  button, the scrubber and the tab strip — only the cover (with the song
  details under it), the lyrics and the artwork backdrop remain. Press **Esc**
  to leave. An extra toggle hides the cover for a full-width lyrics view.
- **Word-by-word karaoke lyrics**: inside the active line, each word lights up
  as it is sung — timings are spread evenly from the line's stamps, or taken
  from real per-word data when the source provides it (enhanced LRC). Toggle
  in Settings → Lyrics.
- **New settings**: lyrics text size, album-cover size in the player card, and
  animated-artwork placement (device default, lyrics background, player
  background, or the cover thumbnail itself).
- The desktop mini player is now a **centered floating pill** instead of a
  full-width bar.
- The floating desktop nav highlights the active tab with the **adaptive
  accent** — it follows the color of the playing artwork.
- The theme toggle moved out of the top bar; the app logo moved in. Web build
  ships proper favicon, Apple touch icon and social-preview images.

**Fixes**

- **iOS: settings and saves now persist across restarts** — the capability set
  was never granted for the iOS target, so every permission was silently
  denied.
- **iOS builds again**: the battery crate's IOKit code is no longer linked into
  iOS archives (it used to fail with undefined symbols).
- **Android**: real lock-screen media card and status-bar handling through an
  in-app media3 plugin.
