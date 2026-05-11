# Spotify Taskbar Widget 🎵🚀

A premium, ultra-slim Spotify mini-player for the Windows taskbar. Built with **Tauri v2** and **Rust** for maximum performance and a native feel.

![Spotify Taskbar Widget](./assets/header.png)

## Screenshots 📸
![Taskbar Integration](./assets/screenshot-taskbar.png)
*Seamlessly integrated into the Windows 11 taskbar.*

![Widget Detail](./assets/screenshot-widget.png)
*Dynamic accent colors and ultra-slim 30px profile.*

## Features ✨
- **Perfect Fit**: Ultra-slim 30px height designed specifically for the Windows 11 taskbar.
- **Background Mode**: Close the window and it keeps running in your system tray (Hidden Icons).
- **Dynamic Theming**: Automatically extracts accent colors from album art for a gorgeous, integrated look.
- **Global Control**: Supports system media keys (Play/Pause/Next/Prev).
- **Extreme Efficiency**: Significantly lower memory footprint than the official Spotify Desktop client.

## How it Works 🧠
The widget acts as a high-performance "remote control" for your Spotify session. It uses the **Spotify Web API** to synchronize playback state and control your devices in real-time.

### Why use this instead of the official app?
1. **Performance**: Official Spotify is built on Electron (Chromium), which can be a memory hog. This widget is built on **Tauri + Rust**, utilizing the native Windows WebView2. It typically uses **90% less RAM** than the full desktop app.
2. **Focus**: Keep your music controls visible without having a giant window taking up screen space or cluttering your Alt-Tab menu.
3. **Native Feel**: Designed to look like a first-party Windows feature, not a website in a box.

## Installation 📦
1. Download the latest `Spotify Taskbar Widget_x64-setup.exe` from the [Releases](https://github.com/MadalinaCarcea221989/Spotify-Taskbar-Widget/releases) page.
2. Run the installer.
3. Launch the widget and connect your Spotify account.

## Development 🛠️
To build the project from source:

1. Install [Rust](https://rustup.rs/) and [Node.js](https://nodejs.org/).
2. Clone the repository.
3. Navigate to `tauri-widget`:
   ```bash
   npm install
   npm run tauri build
   ```

## License 📄
Distributed under the MIT License. See `LICENSE` for more information.
