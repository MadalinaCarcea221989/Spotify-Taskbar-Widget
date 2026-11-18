//! Native OS media session ("now playing" card, media flyout, apps like Fenn).
//!
//! The widget is a remote control for the Spotify Web API and plays no audio of
//! its own, so the OS never learns that something is playing. Windows only lists
//! an app in its media controls (SMTC) once the app registers a session, which
//! is what this module does: it mirrors the track and play state we already poll
//! from Spotify and turns button presses from the OS into the `media-key` events
//! the frontend already handles.
//!
//! Windows only for now. Other platforms get a no-op with the same API.

use serde::Deserialize;

/// What the frontend sends after every poll. `None` means nothing is playing.
// Only the Windows implementation reads these fields; the stub elsewhere doesn't.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrackInfo {
    pub title: String,
    pub artist: String,
    #[serde(default)]
    pub album: String,
    #[serde(default)]
    pub cover_url: String,
    #[serde(default)]
    pub duration_ms: u64,
    #[serde(default)]
    pub position_ms: u64,
    pub is_playing: bool,
}

pub use imp::MediaSession;

#[cfg(target_os = "windows")]
mod imp {
    use super::TrackInfo;
    use souvlaki::{
        MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition,
        PlatformConfig,
    };
    use std::ffi::c_void;
    use std::time::Duration;

    /// Title, artist, album, cover and duration of what the OS currently shows.
    /// Metadata is only re-sent when this changes, so the cover isn't fetched
    /// again on every poll.
    type Shown = (String, String, String, String, u64);

    pub struct MediaSession {
        controls: MediaControls,
        shown: Option<Shown>,
    }

    impl MediaSession {
        /// `on_action` receives "play_pause", "next" or "prev", the same strings
        /// the global media-key handler emits.
        pub fn new(
            hwnd: *mut c_void,
            on_action: impl Fn(&'static str) + Send + 'static,
        ) -> Result<Self, String> {
            let mut controls = MediaControls::new(PlatformConfig {
                display_name: "Spotify Taskbar Widget",
                dbus_name: "spotify_taskbar_widget",
                hwnd: Some(hwnd),
            })
            .map_err(|e| e.to_string())?;

            controls
                .attach(move |event| {
                    // The frontend toggles based on the real play state, so
                    // Play, Pause and Toggle all map to one action.
                    let action = match event {
                        MediaControlEvent::Play
                        | MediaControlEvent::Pause
                        | MediaControlEvent::Toggle => "play_pause",
                        MediaControlEvent::Next => "next",
                        MediaControlEvent::Previous => "prev",
                        _ => return,
                    };
                    on_action(action);
                })
                .map_err(|e| e.to_string())?;

            Ok(Self {
                controls,
                shown: None,
            })
        }

        pub fn update(&mut self, info: Option<&TrackInfo>) -> Result<(), String> {
            let Some(t) = info else {
                self.shown = None;
                return self
                    .controls
                    .set_playback(MediaPlayback::Stopped)
                    .map_err(|e| e.to_string());
            };

            let key: Shown = (
                t.title.clone(),
                t.artist.clone(),
                t.album.clone(),
                t.cover_url.clone(),
                t.duration_ms,
            );
            if self.shown.as_ref() != Some(&key) {
                self.controls
                    .set_metadata(MediaMetadata {
                        title: Some(&t.title),
                        artist: Some(&t.artist),
                        album: non_empty(&t.album),
                        cover_url: non_empty(&t.cover_url),
                        duration: Some(Duration::from_millis(t.duration_ms)),
                    })
                    .map_err(|e| e.to_string())?;
                self.shown = Some(key);
            }

            let progress = Some(MediaPosition(Duration::from_millis(t.position_ms)));
            let playback = if t.is_playing {
                MediaPlayback::Playing { progress }
            } else {
                MediaPlayback::Paused { progress }
            };
            self.controls
                .set_playback(playback)
                .map_err(|e| e.to_string())
        }
    }

    fn non_empty(s: &str) -> Option<&str> {
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    use super::TrackInfo;
    use std::ffi::c_void;

    pub struct MediaSession;

    impl MediaSession {
        pub fn new(
            _hwnd: *mut c_void,
            _on_action: impl Fn(&'static str) + Send + 'static,
        ) -> Result<Self, String> {
            Ok(Self)
        }

        pub fn update(&mut self, _info: Option<&TrackInfo>) -> Result<(), String> {
            Ok(())
        }
    }
}
