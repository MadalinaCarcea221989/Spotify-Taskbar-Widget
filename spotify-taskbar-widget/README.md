# Spotify Taskbar Widget

A beautiful, lightweight Spotify mini-player that sits in your Windows 11 taskbar like a native widget. Control your music without switching windows - featuring Windows 11 Acrylic design, smooth animations, and real-time playback control.

## Features

### Widget Mode (Default)
- **Windows 11 Native Design**: Acrylic glass effect, rounded corners, and smooth animations matching native Windows widgets
- **Taskbar Integration**: Positioned at taskbar edge (48px height) for seamless integration
- **Real-Time Updates**: Live album art, track title, artist, and playback state
- **Full Playback Control**: Play/pause, next, previous, and like/unlike tracks
- **Like Button**: Save your favorite tracks directly to your Spotify library

### Floating Mode
- **Draggable**: Click and drag anywhere on the widget to move it
- **Resizable**: Adjust size to your preference
- **Always-on-Top**: Stays visible above all windows

### Advanced Features
- **Performance Optimized**: Adaptive polling (3s active, 8s idle, 15s hidden) for minimal CPU/RAM usage
- **Secure Authentication**: Uses Spotify's PKCE flow - no client secret needed
- **Design Tools**: Built-in DevTools (F12) for live CSS editing
- **Auto-Start**: Optional start-at-login functionality
- **Auto-Hide**: Optional auto-hide when clicking away
- **System Tray**: Quick access to all controls from tray icon

## Requirements

- **Windows 11** (optimized for Windows 11 design language)
- **Node.js** 18+ ([Download](https://nodejs.org/))
- **Spotify Account** (Premium required for playback control)
- **Spotify Developer App** (free - see setup below)

## Quick Start

### 1. Create Spotify App

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/) and log in
2. Click **"Create app"**
3. Fill in the details:
   - **Name**: "Spotify Taskbar Widget" (or any name you prefer)
   - **Description**: "Personal taskbar widget for Spotify"
   - **Redirect URI**: `http://127.0.0.1:4381/callback` **Must be exactly this**
4. Copy your **Client ID** (you'll need it in step 3)

### 2. Install & Configure

```bash
# Clone the repository
git clone https://github.com/MadalinaCarcea221989/Spotify-Taskbar-Widget.git
cd spotify-taskbar-widget/spotify-taskbar-widget

# Install dependencies
npm install

# Create config file
copy config.example.json config.json  # Windows
# or
cp config.example.json config.json    # macOS/Linux
```

Open `config.json` and paste your **Client ID** from step 1.

### 3. Run the Widget

```bash
npm start
```

The widget will appear at the bottom-left of your screen in **Widget Mode** by default!

## Usage

### First Launch

1. Click the **Connect** button in the widget
2. Your browser will open to Spotify's authorization page
3. Log in and grant permissions
4. The browser will redirect back and close automatically
5. Start playing music on any Spotify device (desktop, mobile, web)
6. The widget will automatically display your current track!

### Tray Menu Options

Right-click the system tray icon to access:

- **Show/Hide**: Toggle widget visibility
- **Widget Mode / Floating Mode**: Switch between taskbar-style and floating window
- **Auto-hide on blur**: Automatically hide when clicking away
- **Keep on top (continuous)**: Force always-on-top behavior
- **Open DevTools**: Live CSS editing and debugging
- **Start at Login**: Launch widget automatically on Windows startup

### Keyboard Shortcuts

- **F12** or **Ctrl+Shift+I**: Open DevTools for design customization

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **"Not Authorized"** | Click tray icon → "Reconnect / Login" to refresh tokens |
| **"No Active Device"** | Open Spotify on any device and start playback |
| **Controls don't work** | Playback control requires Spotify Premium |
| **Wrong redirect URI** | Make sure you used `http://127.0.0.1:4381/callback` exactly |
| **Widget not showing** | Check system tray → right-click icon → "Show / Hide" |
| **Token expired** | Tokens stored in `%APPDATA%/Spotify-Taskbar-Widget/tokens.json` - delete and reconnect |

## Customization

### Visual Design

Press **F12** to open DevTools and live-edit CSS:

```css
/* Example: Change accent color from purple to green */
:root {
    --accent-color: #1DB954; /* Spotify green */
}

/* Example: Adjust transparency */
html.docked #widget-container {
    background: rgba(32, 32, 32, 0.9); /* More solid */
}
```

See [DESIGN-GUIDE.md](DESIGN-GUIDE.md) for detailed customization instructions.

### Widget Positioning

The widget automatically positions itself at the taskbar edge. To change position, edit `main.js` in the `positionWindowAroundTaskbar()` function.

## Security & Privacy

- **PKCE Flow**: Uses Authorization Code with PKCE - no client secret required
- **Local Storage**: Tokens stored locally in `%APPDATA%/Spotify-Taskbar-Widget/`
- **No Data Collection**: All API calls go directly to Spotify, nothing is logged or tracked
- **Open Source**: All code is visible for review

## Performance

- **Adaptive Polling**: 3s when playing, 8s when idle, 15s when hidden
- **Minimal Resources**: ~30-50MB RAM, <1% CPU when idle
- **Hardware Acceleration**: Disabled for lower GPU usage
- **Efficient Updates**: Only polls when widget is visible

## Building (Optional)

To create a standalone `.exe`:

```bash
npm install --save-dev electron-builder
npm run build
```

The built app will be in the `dist/` folder.

## Contributing

Contributions are welcome! Feel free to:

- Report bugs via GitHub Issues
- Submit feature requests
- Fork and create pull requests

## License

MIT License - See [LICENSE](LICENSE) for details.

## Acknowledgments

- Built with [Electron](https://www.electronjs.org/)
- Uses [Spotify Web API](https://developer.spotify.com/documentation/web-api/)
- Windows 11 design inspired by native widgets
