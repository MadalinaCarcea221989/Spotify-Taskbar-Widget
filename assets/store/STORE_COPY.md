# Store Listing Copy — Spotify Taskbar Widget

## Tagline
Instant music controls in your taskbar — lightweight, secure, and designed for Windows 11.

## Short description
A compact Spotify mini-player that blends into the Windows 11 taskbar. See album art, control playback, and switch to a floating window for full control — all with PKCE-secured authentication.

## Feature bullets (optimized for conversion)
- Real-time album art and metadata in your taskbar
- Play, pause, skip and seek with a native Windows 11 look-and-feel
- Lightweight: minimal CPU and memory footprint
- Secure PKCE authentication (no long-lived secrets stored)
- Floating window mode for multi-monitor workflows

## What's New (template)
Version {version} — {release date}
- Added: {short feature}
- Improved: {perf/security/UX improvements}
- Fixed: {bug fixes}

## Long description
Spotify Taskbar Widget gives you instant access to your music without switching apps. Designed with Windows 11 aesthetics and privacy-first authentication, it shows album art, playback controls, and a compact UI that sits neatly in your taskbar. Perfect for developers, creators, and multitaskers who want quick music control while staying focused.

## Promotional text
Control your music at a glance. Beautiful, fast, and secure.

## Call-to-action lines
- "Download now — listen without interruptions."
- "Try the floating window for uninterrupted workflows."

## Suggested keywords
spotify, music, player, taskbar, windows, widget, mini-player, audio, quick controls

## Export & Asset Notes
- Icons: Deliver PNG exports at required sizes. Use the SVG source files in `assets/store/icons/` as the canonical source.
- Screenshots: Each screenshot SVG in `assets/store/screenshots/` is 1920x1080; export to PNG and annotate as needed.
- Hero image: `assets/store/hero/hero-image.svg` (1920x1080)

## Export commands (PowerShell + Inkscape/ImageMagick)
If you have Inkscape installed, export PNGs with:

```powershell
# export screenshots
inkscape assets/store/screenshots/screenshot-1-taskbar.svg --export-type=png --export-filename=assets/store/screenshots/screenshot-1-taskbar.png --export-width=1920 --export-height=1080

# export icon PNGs
inkscape assets/store/icons/spotify-overlay-source.svg --export-type=png --export-filename=assets/store/icons/icon-256.png --export-width=256 --export-height=256

# create ICO (ImageMagick required)
magick convert assets/store/icons/icon-256.png -resize 256x256 assets/store/icons/spotify-widget.ico
```

If you need me to export PNG/ICO files for you, tell me and I'll run the conversions here.
