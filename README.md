# Spotify Taskbar Widget

<p align="center">
  <img src="./assets/header.png" alt="Spotify Taskbar Widget Banner" width="600">
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/MadalinaCarcea221989/Spotify-Taskbar-Widget?style=for-the-badge&color=1DB954" alt="Release">
  <img src="https://img.shields.io/github/actions/workflow/status/MadalinaCarcea221989/Spotify-Taskbar-Widget/release.yml?style=for-the-badge" alt="Build Status">
  <img src="https://img.shields.io/github/license/MadalinaCarcea221989/Spotify-Taskbar-Widget?style=for-the-badge" alt="License">
</p>

---

A premium, ultra-slim (35px) Spotify mini-player designed for native desktop integration. Compatible with Windows 11, macOS, and Linux, this widget integrates into your Taskbar or Menu Bar for seamless playback control.

## Performance Comparison

| Feature | Official Spotify App | Spotify Taskbar Widget |
| :--- | :---: | :---: |
| RAM Usage | ~500MB - 1GB+ | **~50MB - 80MB** |
| Footprint | Full Window | **Ultra-Slim 35px** |
| Tech Stack | Electron | **Tauri + Rust** |
| System Impact | High | **Minimal** |
| Integration | Standard Window | **Native Desktop Module** |

## Screenshots
<p align="center">
  <img src="./assets/screenshot-taskbar.png" width="800" alt="Taskbar Integration">
  <br>
  <em>Integrated into the Windows 11 taskbar.</em>
</p>

<p align="center">
  <img src="./assets/screenshot-widget.png" width="500" alt="Widget Detail">
  <br>
  <em>Dynamic accent colors and polished interface.</em>
</p>

## Key Features
- **Precision Fit**: Specifically calibrated 35px height for the Windows 11 taskbar.
- **Cross-Platform**: Intelligent positioning for Windows, macOS, and Linux.
- **Dynamic Theming**: Automatic color extraction from album art for visual integration.
- **High Performance**: Built with Rust for immediate responsiveness and low resource overhead.
- **Background Operation**: Runs in the system tray to maintain a clean workspace.
- **System Integration**: Support for global media keys and auto-focus functionality.

## Technical Overview
The widget serves as a high-performance remote bridge for your Spotify account. Utilizing the official Spotify Web API, it synchronizes playback across devices while consuming significantly fewer resources than the standard desktop client.

## Installation
1. Visit the [Releases](https://github.com/MadalinaCarcea221989/Spotify-Taskbar-Widget/releases) page.
2. Download the installer for your operating system:
   - Windows: .exe or .msi
   - macOS: .dmg
   - Linux: .deb
3. Launch the application and authenticate with your Spotify account.

## Tech Stack
<p align="left">
  <img src="https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white" alt="Rust">
  <img src="https://img.shields.io/badge/Tauri-FFC131?style=for-the-badge&logo=tauri&logoColor=white" alt="Tauri">
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="JS">
  <img src="https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white" alt="CSS">
</p>

## License
This project is licensed under the MIT License. See the LICENSE file for more information.

---
<p align="center">
  Built for performance and desktop efficiency.
</p>
