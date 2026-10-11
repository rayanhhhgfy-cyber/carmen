/**
 * "Update available" prompt — shown once per launch when GitHub reports a
 * newer tag than the running build (see services/updateCheck).
 *
 * "Later" dismisses that specific version for good; "Update" opens the
 * releases page in the system browser — the installers are attached there,
 * the app never downloads or replaces itself.
 */
import { useEffect, useState } from 'react';

import { openReleasesPage, checkForUpdate, dismissUpdate, type UpdateInfo } from '../services/updateCheck';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from './ui';

export default function UpdateDialog() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  // The check runs a beat after mount so first paint never waits on it.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void checkForUpdate().then((info) => {
        if (!cancelled && info) setUpdate(info);
      });
    }, 3000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const close = () => setUpdate(null);

  return (
    <Dialog open={update !== null} onClose={close} maxWidth="xs" fullWidth aria-label="Update available">
      <DialogTitle>Update available</DialogTitle>
      <DialogContent>
        Carmen {update?.latest} has been released — you have {update?.current}. The new
        installers are on the GitHub releases page.
      </DialogContent>
      <DialogActions>
        <Button
          onClick={() => {
            if (update) dismissUpdate(update.latest);
            close();
          }}
        >
          Later
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            void openReleasesPage();
            close();
          }}
        >
          Update
        </Button>
      </DialogActions>
    </Dialog>
  );
}
