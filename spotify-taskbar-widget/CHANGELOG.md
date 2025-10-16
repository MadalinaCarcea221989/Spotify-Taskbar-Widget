# Changelog

## [1.0.0] - 2025-10-16

### Features

#### Widget Mode (Default)
- Windows 11 native design with Acrylic glass effect
- 48px height matching Windows 11 taskbar exactly
- Positioned at taskbar edge for seamless integration
- Smooth hover animations and transitions
- Auto-hide on blur option

#### Playback Control
- Real-time now playing display
- Play/pause, next, previous controls
- Like/unlike tracks (save to library)
- Album art with rounded corners
- Track title and artist display

#### Performance Optimizations
- Adaptive polling intervals (3s/8s/15s)
- Hardware acceleration disabled for lower resource usage
- Visibility-based polling adjustments
- Minimal CPU/RAM footprint (~30-50MB, <1% CPU idle)

#### Developer Features
- DevTools integration (F12, Ctrl+Shift+I)
- Live CSS editing capabilities
- Design guide included

#### System Integration
- System tray icon with context menu
- Start at login option
- Keep on top functionality
- Floating mode alternative

### Security
- Authorization Code + PKCE flow (no client secret)
- Tokens stored in APPDATA directory
- No data collection or tracking

### Design
- Windows 11 Fluent Design
- Acrylic background with blur effect
- Smooth scale animations on buttons
- Responsive hover states
- Purple accent color (#7C4DFF)

### Removed
- AppBar helper (caused Windows shell conflicts)
- Native shell integration code (disabled for stability)
- Debug log files

### Documentation
- Comprehensive README with clear sections
- DESIGN-GUIDE.md for visual customization
- WIDGET-FEATURES.md explaining implementation choices
- Troubleshooting table
- Quick start guide

### Known Issues
- Widget mode is safe positioning only (no true shell integration)
- Requires Spotify Premium for playback control
- May not display ads or local file metadata

### Next Steps
- [ ] Add keyboard shortcuts for playback control
- [ ] Custom themes/color schemes
- [ ] Playlist quick-switcher
- [ ] Volume control slider
- [ ] Progress bar with seeking
- [ ] Queue display
