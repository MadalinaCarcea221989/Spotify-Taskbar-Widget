# Spotify Taskbar Widget

A lightweight, always-on-top Spotify mini-player that docks near your Windows 11 taskbar. Control your music without switching windows.

![Screenshot Placeholder](https://via.placeholder.com/400x100.png?text=App+Screenshot+Coming+Soon)

## Features

-   **Minimal Interface**: Shows current album art, track title, and artist.
-   **Playback Controls**: Play, pause, next, and previous track.
-   **Always-on-Top**: Floats above all other windows for easy access.
-   **Draggable**: Click and drag anywhere on the widget (except the buttons) to move it.
-   **Secure**: Uses Spotify's PKCE authentication flow, so your "Client Secret" is never needed or stored.
-   **Tray Icon**: Access essential controls like Show/Hide, Authorize, and Quit from the system tray.

## Prerequisites

-   **Node.js**: Version 18 or newer.
-   **Spotify Account**: A regular or Premium Spotify account. Note that playback *control* requires an active Spotify device and is a Premium feature.
-   **Spotify Developer App**: You need to create a Spotify app in their developer dashboard.

## How to Set Up a Spotify App

1.  **Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/)** and log in.
2.  Click **"Create app"**.
3.  Give it a name (e.g., "Taskbar Widget") and description.
4.  Once created, find your **Client ID** and copy it.
5.  Click **"Edit Settings"**.
6.  In the **Redirect URIs** field, add exactly: `http://localhost:4381/callback`
7.  Click **"Save"**.

## Installation & Usage

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-username/spotify-taskbar-widget.git
    cd spotify-taskbar-widget
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure the app:**
    -   Create a `config.json` file by copying the example file.
        -   On Windows: `copy config.example.json config.json`
        -   On macOS/Linux: `cp config.example.json config.json`
    -   Open `config.json` in a text editor.
    -   Paste your **Client ID** from the Spotify Developer Dashboard into the `client_id` field.

4.  **Run the application:**
    ```bash
    npm start
    ```

## How It Works

-   On first launch, the widget will show a "Connect" button.
-   Clicking **Connect** will open your web browser to the Spotify authorization page.
-   Log in and grant the requested permissions. You will be redirected to a localhost page, and the app will capture the authorization token.
-   The browser tab should close automatically, and the widget will be connected.
-   Start playing music on any of your Spotify-connected devices (desktop app, mobile, web player).
-   The widget will automatically display the currently playing track and allow you to use the playback controls.

## Troubleshooting

-   **"Not Authorized" or "Connect" shows:** Your authentication token may have expired. Click the tray icon and select "Authorize" or simply click "Connect" on the widget.
-   **"No Active Device"**: The Spotify API requires an active player to control music. Open Spotify on any device and start playback. The widget should detect it within a few seconds.
-   **Controls don't work / 403 Forbidden Error**: Controlling playback is a Spotify Premium feature. This error can also occur if your token is invalid.
-   **Ads or Local Files**: The widget may not display metadata for advertisements or local files that are not synced via Spotify.
-   **Tokens File**: Your authentication tokens are stored in `tokens.json`. If you're having persistent issues, you can delete this file by running `npm run clean-tokens` and then restart the app to re-authenticate.

## Packaging (Optional)

To create a standalone `.exe` installer for this application, you can use a tool like [Electron Builder](https://www.electron.build/). You would need to add it as a dev dependency and configure a `build` section in your `package.json`.

```bash
npm install --save-dev electron-builder
```

This project is not pre-configured for building, but it is a standard Electron app.

## Security Note

This application uses the recommended **Authorization Code with PKCE** flow. This is more secure than older methods because it does not require storing a "Client Secret". The access token is stored locally on your machine in `tokens.json`.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.