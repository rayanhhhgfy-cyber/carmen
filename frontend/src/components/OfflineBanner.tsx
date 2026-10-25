import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * Slim offline banner — the visible half of the PWA work.
 *
 * The service worker is what lets the app *open* offline; this banner is
 * what makes that state legible instead of confusing: online sections
 * (Home feed is client-cached, Search / Discover / Stats hit the API)
 * simply cannot refresh, while everything local — Library, Downloads,
 * and every downloaded song — works as normal. It listens to the
 * browser's online/offline events, so it appears and disappears on its
 * own; it never blocks navigation or playback.
 */
export default function OfflineBanner() {
  const [offline, setOffline] = useState(
    () => typeof navigator !== 'undefined' && !navigator.onLine,
  );

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2 text-sm text-muted"
    >
      <span>You're offline — your downloaded songs still play.</span>
      <Link to="/library" className="shrink-0 font-semibold text-accent no-underline">
        Open Library
      </Link>
    </div>
  );
}
