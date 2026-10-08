/**
 * Small building blocks shared by the Library pages: the page summary line
 * (the tab bar owns the titles now), the empty-state hint and the two
 * dialogs (playlist form and destructive confirmation) used by both the
 * grid and the detail view.
 */
import { useEffect, useState, type ReactNode } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

import { CloseIcon } from './glyphs';

/* ── page summary ─────────────────────────────────────────────────────── */

interface PageSummaryProps {
  /** Small muted status line under the tab bar (counts, freshness, …). */
  children?: ReactNode;
  /** Rendered on the far right (buttons, filters, …). */
  action?: ReactNode;
}

/**
 * One quiet line introducing a Library page — the sticky tab bar already
 * carries the title, so pages only need their caption and any page-level
 * action (e.g. "New playlist").
 */
export function PageSummary({ children, action }: PageSummaryProps) {
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5, minHeight: 28 }}>
      {children && (
        <Typography variant="body2" color="text.secondary" sx={{ minWidth: 0 }}>
          {children}
        </Typography>
      )}
      {action && <Box sx={{ ml: 'auto', flexShrink: 0, display: 'flex', gap: 1 }}>{action}</Box>}
    </Stack>
  );
}

/* ── empty state ──────────────────────────────────────────────────────── */

interface EmptyHintProps {
  title: string;
  hint?: string;
  icon?: ReactNode;
  /** One quiet line instead of the full centred block. */
  dense?: boolean;
}

export function EmptyHint({ title, hint, icon, dense = false }: EmptyHintProps) {
  if (dense) {
    return (
      <Typography variant="caption" color="text.disabled" sx={{ display: 'block', py: 0.5 }}>
        {title}
        {hint ? ` — ${hint}` : ''}
      </Typography>
    );
  }
  return (
    <Box sx={{ py: 5, textAlign: 'center', px: 2 }}>
      {icon && (
        <Box sx={{ color: 'text.disabled', display: 'flex', justifyContent: 'center', mb: 1 }} aria-hidden>
          {icon}
        </Box>
      )}
      <Typography variant="subtitle1" color="text.secondary">
        {title}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.disabled">
          {hint}
        </Typography>
      )}
    </Box>
  );
}

/* ── confirmation dialog ──────────────────────────────────────────────── */

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  /** Renders a spinner-free "busy" label while the action settles. */
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Destructive-action confirmation (delete a playlist, …). */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 700 }}>{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">
          {message}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button color="error" variant="contained" onClick={onConfirm} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ── playlist form dialog ─────────────────────────────────────────────── */

interface PlaylistFormDialogProps {
  open: boolean;
  /** `create` also collects the optional description, `rename` is name-only. */
  mode: 'create' | 'rename';
  initialName?: string;
  initialDescription?: string;
  /** Trimmed values — stays open (and busy) until the promise settles. */
  onSubmit: (name: string, description: string) => Promise<void>;
  onClose: () => void;
}

/** Create / rename a playlist; the name is required, the description optional. */
export function PlaylistFormDialog({
  open,
  mode,
  initialName = '',
  initialDescription = '',
  onSubmit,
  onClose,
}: PlaylistFormDialogProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the fields every time the dialog opens (rename needs the old name).
  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setDescription(initialDescription);
    setSaving(false);
    setError(null);
  }, [open, initialName, initialDescription]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(trimmed, description.trim());
      onClose();
    } catch (submitError) {
      console.warn('[library] playlist form failed', submitError);
      setError('Could not save the playlist — please try again.');
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      fullWidth
      maxWidth="xs"
      slotProps={{ paper: { sx: { borderRadius: 3 } } }}
    >
      <DialogTitle sx={{ fontWeight: 700 }}>
        {mode === 'create' ? 'New playlist' : 'Rename playlist'}
        <IconButton
          aria-label="Close"
          onClick={onClose}
          disabled={saving}
          sx={{ position: 'absolute', right: 8, top: 8 }}
          size="small"
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          label="Playlist name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={saving}
          error={Boolean(error)}
          helperText={error ?? ' '}
          margin="dense"
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit();
          }}
        />
        {mode === 'create' && (
          <TextField
            fullWidth
            label="Description (optional)"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={saving}
            margin="dense"
            minRows={2}
            multiline
          />
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={!name.trim() || saving}>
          {saving ? (
            <CircularProgress size={18} />
          ) : mode === 'create' ? (
            'Create'
          ) : (
            'Save'
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
