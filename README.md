# Spotify Taskbar Widget

A beautiful, lightweight Spotify mini-player for Windows 11 that sits in your taskbar like a native widget. Control your music, see album art, and use playback controls without switching windows.

## Features
- Windows 11 acrylic design, rounded corners, smooth animations
- Taskbar integration (48px height) or floating mode
- Real-time updates: album art, track title, artist, playback state
- Full playback control: play/pause, next, previous, like/unlike
- Secure authentication (PKCE, no client secret)
- Tokens encrypted at rest
- Auto-start, auto-hide, system tray menu
- DevTools for live CSS editing

## Quick Start
1. Clone the repo:
   ```bash
   git clone https://github.com/MadalinaCarcea221989/Spotify-Taskbar-Widget.git
   cd Spotify-Taskbar-Widget/spotify-taskbar-widget
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create your Spotify app and config file (see widget README for details).
4. Run the widget:
   ```bash
   npm start
   ```

## Packaging as a Standalone App
To build a Windows `.exe`:
```bash
npm run dist
```
Find the portable app in `dist/win-unpacked/Spotify Taskbar Widget.exe`.

## Security & Privacy
- Sensitive files (`config.json`, `tokens.json`, `settings.json`, `window-state.json`, `dist/`, `build/`) are excluded from git by `.gitignore`.
- Spotify tokens are encrypted at rest.

## More Info & Advanced Usage
See [`spotify-taskbar-widget/README.md`](./spotify-taskbar-widget/README.md) for:
- Widget features and customization
- Troubleshooting
- Visual design guide
- Developer notes

---
Maintained by MadalinaCarcea221989. Contributions welcome!
