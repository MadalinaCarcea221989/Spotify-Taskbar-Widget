# Spotify Taskbar Widget 

A premium, ultra-slim Spotify mini-player for the Windows taskbar. Built with **Tauri v2** and **Rust** for maximum performance and a native feel.

![App Icon](assets/app-icon-premium-square.png)

## Features ✨
- **Perfect Fit**: Ultra-slim 30px height designed specifically for the Windows 11 taskbar.
- **Background Mode**: Close the window and it keeps running in your system tray (Hidden Icons).
- **Dynamic Theming**: Automatically extracts accent colors from album art for a gorgeous, integrated look.
- **Global Control**: Supports system media keys (Play/Pause/Next/Prev).
- **Fast & Light**: Native Rust backend with zero Electron overhead.
- **Smart Positioning**: Automatically detects taskbar size and scaling to snap perfectly to the bottom of your screen.

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
4. Find your binaries in `src-tauri/target/release/bundle/`.

## License 📄
Distributed under the MIT License. See `LICENSE` for more information.
