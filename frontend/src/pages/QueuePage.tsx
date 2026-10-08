import Artwork from "../components/Artwork";
import MarqueeText from "../components/MarqueeText";
import QueueTab from "../components/QueueTab";
import RelatedTab from "../components/RelatedTab";
import { Box, Chip, Container, Stack, Typography } from "@mui/material";
import { EmptyState } from "../components/TrackList";
import { usePlayer } from "../player/PlayerContext";

/**
 * Queue page: now playing, up next and the related songs that keep the
 * music going when the queue ends.
 */
export default function QueuePage() {
  const player = usePlayer();
  const track = player.current;

  if (!track) {
    return (
      <Container maxWidth="md" sx={{ pt: 4 }}>
        <Typography variant="h5" sx={{ mb: 2 }}>
          Queue
        </Typography>
        <EmptyState
          title="Nothing is playing yet"
          hint="Start a song from the home page or search."
        />
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ pt: { xs: 1.5, md: 3 } }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h5">Queue</Typography>
          <Typography variant="body2" color="text.secondary">
            Now playing
          </Typography>
        </Box>

        <Box
          onClick={() => player.setSheetOpen(true)}
          sx={{
            display: 'flex',
            gap: 2,
            alignItems: 'center',
            p: 1.5,
            borderRadius: 3,
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            cursor: 'pointer',
          }}
        >
          <Artwork
            src={track.artwork}
            alt=""
            iconSize={28}
            motion={{
              album: track.albumName,
              videoId: track.videoId,
              title: track.title,
              artist: track.artist,
            }}
            sx={{ width: 64, height: 64, borderRadius: 2, flexShrink: 0 }}
          />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <MarqueeText text={track.title} variant="subtitle1" />
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
              {track.artist}
            </Typography>
            <Chip
              size="small"
              label={player.isPlaying ? 'Playing' : 'Paused'}
              color="primary"
              variant="outlined"
              sx={{ mt: 0.75, height: 20 }}
            />
          </Box>
        </Box>

        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 3, overflow: 'hidden', bgcolor: 'background.paper' }}>
          <QueueTab />
        </Box>

        <Box>
          <Typography variant="subtitle1" sx={{ px: 1, mb: 0.5 }}>
            Related songs
          </Typography>
          <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 3, overflow: 'hidden', bgcolor: 'background.paper' }}>
            <RelatedTab />
          </Box>
        </Box>
      </Stack>
    </Container>
  );
}
