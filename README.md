[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/R6R71MYWI0)


# Spotify Taskbar Widget

A beautiful, lightweight Spotify mini-player for Windows 11 that sits in your taskbar like a native widget. Control your music, see album art, and use playback controls without switching windows.

![Spotify Taskbar Widget](assets/store/screenshots/screenshot-1.png)

## Features

- 🎵 **Real-time Spotify integration** - Album art, track info, playback state
- 🎨 **Native Windows 11 design** - Acrylic effects, rounded corners, smooth animations
- 📍 **Smart taskbar positioning** - Locks into taskbar or floats as needed
- 🎮 **Full playback controls** - Play/pause, next/previous, like/unlike tracks
- 🔒 **Secure authentication** - PKCE flow, encrypted token storage
- 🔔 **Smart notifications** - Toast notifications with controls
- ⚙️ **Customizable settings** - Theme, behavior, account management
- 🚀 **Auto-start & tray** - System tray menu, auto-hide options

## Installation

### Option 1: Download Pre-built Installer (Recommended)

1. Go to [Releases](https://github.com/MadalinaCarcea221989/Spotify-Taskbar-Widget/releases)
2. Download the latest `Spotify Taskbar Widget Setup X.X.X.exe`
3. Run the installer and follow the setup wizard
4. The widget will launch automatically after installation

### Option 2: Build from Source

1. Clone the repository:

   ```bash
   git clone https://github.com/MadalinaCarcea221989/Spotify-Taskbar-Widget.git
   cd Spotify-Taskbar-Widget
   ```

2. Install dependencies:

   ```bash
   cd spotify-taskbar-widget
   npm install
   ```

3. Set up Spotify app:
   - Create a Spotify app at [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   - Copy `config.example.json` to `config.json`
   - Add your Spotify app's Client ID

4. Run the widget:

   ```bash
   npm start
   ```

## Usage

- The widget appears in your taskbar after first launch
- Click the widget to open the full control panel
- Use the system tray icon to hide/show or quit
- Right-click for quick access to settings

## Building

To create your own installer:

```bash
cd spotify-taskbar-widget
npm run dist
```

The installer will be created in `spotify-taskbar-widget/dist/`

## Security & Privacy

- Spotify tokens are encrypted at rest using AES
- No data is sent to external servers except Spotify's official API
- Configuration files are excluded from version control

## Requirements

- Windows 10/11
- Spotify Premium account (for playback control)
- Internet connection for Spotify API access

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

MIT License - see [LICENSE](LICENSE) for details

---
Built with Electron, maintained by [MadalinaCarcea221989](https://github.com/MadalinaCarcea221989)
