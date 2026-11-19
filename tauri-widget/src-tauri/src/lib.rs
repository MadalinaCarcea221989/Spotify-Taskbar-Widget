use tokio::sync::Mutex;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State, Emitter};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tiny_http::{Server, Response};
use rand::RngCore;
use sha2::{Sha256, Digest};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use keyring::Entry;
use tauri_plugin_global_shortcut::{Code, Shortcut, ShortcutState};

mod media_session;

const KEYRING_SERVICE: &str = "com.madal.spotify-taskbar-widget";
const KEYRING_USER: &str = "spotify-tokens";

#[derive(Serialize, Deserialize, Clone)]
struct Config {
    client_id: String,
    redirect_uri: String,
    port: u16,
    scopes: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct Tokens {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: i64,
    #[serde(default)]
    obtained_at: i64,
}

struct AppState {
    tokens: Mutex<Option<Tokens>>,
    config: Config,
    client: Client,
    // The window's Y position while collapsed, captured right before it grows to
    // show a panel. Collapsing restores this exact value instead of recomputing
    // from whatever the window's geometry happens to be at close time, so the
    // bar can't drift from its resting spot across an expand/collapse cycle.
    collapsed_y: std::sync::Mutex<Option<i32>>,
}

/// The OS media session (Windows media controls). `None` when it couldn't be
/// created or on platforms that don't have one yet; updates are then no-ops.
struct MediaState(std::sync::Mutex<MediaInner>);

struct MediaInner {
    session: Option<media_session::MediaSession>,
    /// Last (title, is_playing) logged, so updates are logged only on change.
    last_logged: Option<(String, bool)>,
    /// Last creation error logged, so a failing retry is logged once, not every poll.
    last_error: Option<String>,
}

/// Creates the OS media session on the "main" window. Button presses from the
/// OS come back as "media-key" events.
#[cfg(target_os = "windows")]
fn create_media_session(app: &AppHandle) -> Result<media_session::MediaSession, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
    let hwnd = window.hwnd().map_err(|e| format!("hwnd() failed: {e}"))?;
    let handle = app.clone();
    media_session::MediaSession::new(hwnd.0, move |action| {
        let _ = handle.emit("media-key", action);
    })
    .map_err(|e| format!("MediaSession::new failed: {e}"))
}

#[cfg(not(target_os = "windows"))]
fn create_media_session(_app: &AppHandle) -> Result<media_session::MediaSession, String> {
    Err("not supported on this platform".into())
}

/// Tokens are stored in the OS credential store (Credential Manager / Keychain /
/// Secret Service) rather than on disk, so a stolen filesystem snapshot alone
/// doesn't hand over a live Spotify session.
fn load_tokens_from_keyring() -> Option<Tokens> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()?;
    let json = entry.get_password().ok()?;
    serde_json::from_str(&json).ok()
}

fn save_tokens_to_keyring(tokens: &Tokens) {
    if let Ok(entry) = Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        if let Ok(json) = serde_json::to_string(tokens) {
            let _ = entry.set_password(&json);
        }
    }
}

fn clear_tokens_from_keyring() {
    if let Ok(entry) = Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        let _ = entry.delete_credential();
    }
}

fn load_config() -> Config {
    // For simplicity, hardcoding for now, or you can read from config.json
    Config {
        client_id: "0f68737f57b7444fb3a39ca14261bbcb".to_string(),
        redirect_uri: "http://127.0.0.1:4381/callback".to_string(),
        port: 4381,
        scopes: "user-read-currently-playing user-read-playback-state user-modify-playback-state user-library-modify user-library-read streaming user-read-email user-read-private".to_string(),
    }
}

fn generate_random_string(length: usize) -> String {
    let mut rng = rand::thread_rng();
    let mut bytes = vec![0u8; length];
    rng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(&bytes)
}

#[tauri::command]
async fn get_access_token(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let mut tokens_guard = state.tokens.lock().await;
    if let Some(tokens) = tokens_guard.as_mut() {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
        if now >= tokens.obtained_at + tokens.expires_in - 60 {
            // Refresh token
            if let Some(ref_token) = &tokens.refresh_token {
                let params = [
                    ("grant_type", "refresh_token"),
                    ("refresh_token", ref_token),
                    ("client_id", &state.config.client_id),
                ];
                let res = state.client.post("https://accounts.spotify.com/api/token")
                    .form(&params)
                    .send().await.map_err(|e| e.to_string())?;
                
                if res.status().is_success() {
                    let mut new_tokens: Tokens = res.json().await.map_err(|e| e.to_string())?;
                    new_tokens.obtained_at = now;
                    if new_tokens.refresh_token.is_none() {
                        new_tokens.refresh_token = Some(ref_token.clone());
                    }
                    *tokens = new_tokens.clone();
                    save_tokens_to_keyring(&new_tokens);
                    return Ok(Some(new_tokens.access_token));
                } else {
                    *tokens_guard = None;
                    clear_tokens_from_keyring();
                    return Ok(None);
                }
            }
        }
        return Ok(Some(tokens.access_token.clone()));
    }
    Ok(None)
}

#[tauri::command]
async fn authorize(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let code_verifier = generate_random_string(64);
    let mut hasher = Sha256::new();
    hasher.update(code_verifier.as_bytes());
    let code_challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());

    let auth_url = format!(
        "https://accounts.spotify.com/authorize?response_type=code&client_id={}&scope={}&redirect_uri={}&code_challenge_method=S256&code_challenge={}",
        state.config.client_id,
        urlencoding::encode(&state.config.scopes),
        urlencoding::encode(&state.config.redirect_uri),
        code_challenge
    );

    tauri_plugin_opener::open_url(auth_url.clone(), None::<&str>).map_err(|e| e.to_string())?;

    let server = Server::http(format!("127.0.0.1:{}", state.config.port)).map_err(|e| e.to_string())?;
    
    // In a real app we shouldn't block the tauri command thread like this for long, 
    // but for local auth it's fast.
    if let Ok(request) = server.recv() {
        let url = request.url().to_string();
        if url.starts_with("/callback?code=") {
            let code = url.split("code=").nth(1).unwrap().split('&').next().unwrap();
            
            let params = [
                ("client_id", state.config.client_id.as_str()),
                ("grant_type", "authorization_code"),
                ("code", code),
                ("redirect_uri", state.config.redirect_uri.as_str()),
                ("code_verifier", &code_verifier),
            ];

            let res = match state.client.post("https://accounts.spotify.com/api/token")
                .form(&params)
                .send().await {
                    Ok(r) => r,
                    Err(e) => {
                        let _ = request.respond(Response::from_string(format!("Network Error: {}", e)).with_status_code(500));
                        return Ok(());
                    }
                };

            if res.status().is_success() {
                let mut tokens: Tokens = match res.json().await {
                    Ok(t) => t,
                    Err(e) => {
                        let _ = request.respond(Response::from_string(format!("Parse Error: {}", e)).with_status_code(500));
                        return Ok(());
                    }
                };
                tokens.obtained_at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;

                save_tokens_to_keyring(&tokens);
                *state.tokens.lock().await = Some(tokens);
                
                let response = Response::from_string("Success! You can safely close this browser window and the widget will start playing.").with_status_code(200);
                let _ = request.respond(response);
                
                app.emit("auth-success", ()).unwrap();
            } else {
                let text = res.text().await.unwrap_or_default();
                let _ = request.respond(Response::from_string(format!("Spotify Error: {}", text)).with_status_code(500));
            }
        }
    }

    Ok(())
}

#[derive(Serialize, Deserialize, Debug)]
struct SpotifyResponse {
    status: u16,
    body: Option<String>,
}

/// Route all Spotify REST calls through Rust's reqwest (persistent TCP pool,
/// no WebView overhead) for maximum command speed.
#[tauri::command]
async fn spotify_fetch(
    state: State<'_, AppState>,
    endpoint: String,
    method: String,
    body: Option<String>,
) -> Result<SpotifyResponse, String> {
    let token = {
        let mut guard = state.tokens.lock().await;
        if let Some(tokens) = guard.as_mut() {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
            if now >= tokens.obtained_at + tokens.expires_in - 60 {
                if let Some(ref_token) = &tokens.refresh_token.clone() {
                    let params = [
                        ("grant_type", "refresh_token"),
                        ("refresh_token", ref_token.as_str()),
                        ("client_id", state.config.client_id.as_str()),
                    ];
                    match state.client.post("https://accounts.spotify.com/api/token").form(&params).send().await {
                        Ok(res) if res.status().is_success() => {
                            if let Ok(mut new_tok) = res.json::<Tokens>().await {
                                new_tok.obtained_at = now;
                                if new_tok.refresh_token.is_none() {
                                    new_tok.refresh_token = Some(ref_token.clone());
                                }
                                save_tokens_to_keyring(&new_tok);
                                let t = new_tok.access_token.clone();
                                *tokens = new_tok;
                                t
                            } else { tokens.access_token.clone() }
                        },
                        Ok(res) if res.status().as_u16() == 400 || res.status().as_u16() == 401 => {
                            // Refresh token is likely revoked or invalid
                            *guard = None;
                            clear_tokens_from_keyring();
                            return Ok(SpotifyResponse { status: 401, body: None });
                        },
                        _ => tokens.access_token.clone() // Network error, try with old token as fallback
                    }
                } else {
                    tokens.access_token.clone()
                }
            } else {
                tokens.access_token.clone()
            }
        } else {
            return Ok(SpotifyResponse { status: 401, body: None });
        }
    };

    let url = format!("https://api.spotify.com/v1{}", endpoint);
    let mut req = match method.to_uppercase().as_str() {
        "POST"   => state.client.post(&url),
        "PUT"    => state.client.put(&url),
        "DELETE" => state.client.delete(&url),
        _        => state.client.get(&url),
    }.header("Authorization", format!("Bearer {}", token));

    let method_upper = method.to_uppercase();
    if let Some(json_body) = body {
        req = req.header("Content-Type", "application/json").body(json_body);
    } else if method_upper == "POST" || method_upper == "PUT" || method_upper == "DELETE" {
        req = req.header("Content-Length", "0");
    }

    match req.send().await {
        Ok(res) => {
            let status = res.status().as_u16();
            let text = res.text().await.ok();
            Ok(SpotifyResponse { status, body: text })
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn exit_app(app: AppHandle) {
    app.exit(0);
}

/// Mirrors the current track and play state into the OS media session, so the
/// Windows media flyout, lock screen and apps like Fenn can show and control it.
/// `info` is `null` when nothing is playing.
#[tauri::command]
fn update_media_session(
    app: AppHandle,
    state: State<'_, MediaState>,
    info: Option<media_session::TrackInfo>,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let inner = &mut *guard;

    // Retry creating the session if it failed at startup.
    if inner.session.is_none() {
        match create_media_session(&app) {
            Ok(session) => {
                eprintln!("Media session registered (retry)");
                inner.session = Some(session);
                inner.last_error = None;
            }
            Err(e) => {
                if inner.last_error.as_deref() != Some(e.as_str()) {
                    eprintln!("Media session retry failed: {e}");
                    inner.last_error = Some(e);
                }
                return Ok(());
            }
        }
    }

    let now = info.as_ref().map(|t| (t.title.clone(), t.is_playing));
    if now != inner.last_logged {
        match &now {
            Some((title, is_playing)) => {
                eprintln!("Media update: title={title:?} is_playing={is_playing}")
            }
            None => eprintln!("Media update: cleared (nothing playing)"),
        }
        inner.last_logged = now;
    }

    let session = inner.session.as_mut().expect("session set above");
    session.update(info.as_ref()).map_err(|e| {
        eprintln!("media update failed: {e}");
        e
    })
}

#[tauri::command]
async fn logout(state: State<'_, AppState>) -> Result<(), String> {
    *state.tokens.lock().await = None;
    clear_tokens_from_keyring();
    Ok(())
}

#[derive(Serialize, Deserialize, Debug)]
struct WindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[tauri::command]
fn save_window_state(app: AppHandle, x: i32, y: i32, width: u32, height: u32) {
    let state = WindowState { x, y, width, height };
    if let Ok(app_dir) = app.path().app_data_dir() {
        let path = app_dir.join("window_state.json");
        if let Ok(json) = serde_json::to_string(&state) {
            let _ = fs::write(path, json);
        }
    }
}

#[tauri::command]
fn load_window_state(app: AppHandle) -> Option<WindowState> {
    if let Ok(app_dir) = app.path().app_data_dir() {
        let path = app_dir.join("window_state.json");
        if let Ok(data) = fs::read_to_string(path) {
            return serde_json::from_str(&data).ok();
        }
    }
    None
}

fn get_window_state_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("window_state.json"))
}

fn persist_window_state(path: &PathBuf, x: i32, y: i32, width: u32, height: u32) {
    let state = WindowState { x, y, width, height };
    if let Ok(json) = serde_json::to_string(&state) {
        let _ = fs::write(path, json);
    }
}

fn is_position_valid_on_monitors(window: &tauri::WebviewWindow, x: i32, y: i32) -> bool {
    // Check if position is within any current monitor's bounds
    if let Ok(monitors) = window.available_monitors() {
        for monitor in monitors {
            let pos = monitor.position();
            let size = monitor.size();

            // Check if position is within this monitor's bounds (with some padding tolerance)
            if x >= pos.x && x < pos.x + size.width as i32 &&
               y >= pos.y && y < pos.y + size.height as i32 {
                return true;
            }
        }
    }
    false
}

/// Scale factor of whichever monitor contains (x, y). At startup the window is
/// still sitting on Tauri's initial default monitor, which may differ from the
/// monitor a saved position lands on (mixed-DPI multi-monitor setups) — so this
/// must be used instead of `window.scale_factor()` when restoring a position.
fn scale_factor_at_position(window: &tauri::WebviewWindow, x: i32, y: i32) -> f64 {
    if let Ok(monitors) = window.available_monitors() {
        for monitor in monitors {
            let pos = monitor.position();
            let size = monitor.size();
            if x >= pos.x && x < pos.x + size.width as i32 &&
               y >= pos.y && y < pos.y + size.height as i32 {
                return monitor.scale_factor();
            }
        }
    }
    window.scale_factor().unwrap_or(1.0)
}

#[tauri::command]
fn focus_window(window: tauri::Window) {
    let _ = window.set_focus();
}

const WINDOW_WIDTH: f64 = 400.0;
const PANEL_COLLAPSED_HEIGHT: f64 = 40.0;
const PANEL_EXPANDED_HEIGHT: f64 = 180.0;

#[tauri::command]
fn snap_to_corner(window: tauri::Window) {
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(WINDOW_WIDTH, PANEL_COLLAPSED_HEIGHT)));

        let scale_factor = monitor.scale_factor();

        // Use physical pixels for position to be precise about the taskbar gap
        let win_w_phys = (WINDOW_WIDTH * scale_factor) as u32;
        let win_h_phys = (PANEL_COLLAPSED_HEIGHT * scale_factor) as u32;
        let taskbar_h_phys = (monitor.size().height as i32 - monitor.work_area().size.height as i32).abs();

        // Snap to bottom-center
        let x = (monitor.size().width as i32 - win_w_phys as i32) / 2;
        let y = monitor.size().height as i32 - win_h_phys as i32 - taskbar_h_phys;

        let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(x, y)));
    }
}

/// Grows/shrinks the (non-resizable-by-user) window to show or hide a panel,
/// always anchoring the bottom edge so it expands upward instead of pushing
/// past the taskbar. Collapsing restores the exact Y captured at expand time
/// (see `AppState::collapsed_y`) rather than recomputing from current
/// geometry, so the bar can't end up a few pixels off from where it started.
/// `height` (logical px) lets the caller ask for just enough room for its
/// content — e.g. the small device popup doesn't need the full playlist-panel
/// height — defaulting to PANEL_EXPANDED_HEIGHT when omitted.
#[tauri::command]
fn set_panel_expanded(window: tauri::Window, state: State<'_, AppState>, expanded: bool, height: Option<f64>) {
    let Ok(pos) = window.outer_position() else { return };
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    // Always re-derive width from the fixed logical constant rather than trusting
    // outer_size(): near a monitor boundary with mixed DPI, Windows can silently
    // rescale the window's physical width on every move to preserve its logical
    // size, and "preserving" that already-drifted value would ratchet it wider
    // on every single expand/collapse cycle.
    let width_phys = (WINDOW_WIDTH * scale_factor).round() as u32;
    let collapsed_height_phys = (PANEL_COLLAPSED_HEIGHT * scale_factor).round() as i32;
    // Clamp against a caller passing a height at or below the collapsed height
    // (e.g. 0 or negative): that would make target_height_phys negative and wrap
    // to a huge value on the `as u32` cast below.
    let expanded_height_phys = ((height.unwrap_or(PANEL_EXPANDED_HEIGHT).max(PANEL_COLLAPSED_HEIGHT)) * scale_factor)
        .round() as i32;

    let mut collapsed_y = state.collapsed_y.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let (target_height_phys, new_y) = if expanded {
        // Reuse the stored baseline if we're already expanded (e.g. resizing the
        // device popup to fit its content mid-open) instead of re-capturing pos.y,
        // which at that point is the already-expanded position, not the true
        // collapsed one — re-capturing it would shift the window further on every
        // subsequent resize call within the same open session.
        let base_y = collapsed_y.unwrap_or(pos.y);
        *collapsed_y = Some(base_y);
        (expanded_height_phys, base_y - (expanded_height_phys - collapsed_height_phys))
    } else {
        let base_y = collapsed_y.take().unwrap_or(pos.y);
        (collapsed_height_phys, base_y)
    };

    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(width_phys, target_height_phys as u32)));
    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(pos.x, new_y)));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts([
                    Shortcut::new(None, Code::MediaPlayPause),
                    Shortcut::new(None, Code::MediaTrackNext),
                    Shortcut::new(None, Code::MediaTrackPrevious),
                ])
                .unwrap()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let action = match shortcut.key {
                        Code::MediaPlayPause => "play_pause",
                        Code::MediaTrackNext => "next",
                        Code::MediaTrackPrevious => "prev",
                        _ => return,
                    };
                    let _ = app.emit("media-key", action);
                })
                .build(),
        )
        .setup(|app| {
            let app_dir = app.path().app_data_dir().unwrap();
            fs::create_dir_all(&app_dir).unwrap();
            let token_path = app_dir.join("tokens.json");

            // Tokens live in the OS credential store. Fall back to migrating an
            // older plaintext tokens.json from disk so existing installs don't
            // get logged out, then remove the plaintext copy.
            let mut initial_tokens = load_tokens_from_keyring();
            if initial_tokens.is_none() {
                if let Ok(data) = fs::read_to_string(&token_path) {
                    if let Ok(tokens) = serde_json::from_str::<Tokens>(&data) {
                        save_tokens_to_keyring(&tokens);
                        let _ = fs::remove_file(&token_path);
                        initial_tokens = Some(tokens);
                    }
                }
            }

            app.manage(AppState {
                tokens: Mutex::new(initial_tokens),
                config: load_config(),
                client: Client::builder()
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                    .unwrap_or_else(|_| Client::new()),
                collapsed_y: std::sync::Mutex::new(None),
            });

            // --- OS media session (Windows media controls) ---
            // Registers the widget so Fenn, the volume flyout and the lock screen
            // can show what's playing. Their play/pause/next/previous buttons come
            // back as the same "media-key" events the global media keys emit, so
            // the frontend handles them with the code it already has.
            let (os_media, last_error) = match create_media_session(app.handle()) {
                Ok(session) => {
                    eprintln!("Media session registered");
                    (Some(session), None)
                }
                Err(e) => {
                    eprintln!("Media session unavailable: {e}");
                    (None, Some(e))
                }
            };
            app.manage(MediaState(std::sync::Mutex::new(MediaInner {
                session: os_media,
                last_logged: None,
                last_error,
            })));

            // --- System Tray Setup ---
            let quit_i = tauri::menu::MenuItem::with_id(app, "quit", "Quit Spotify Widget", true, None::<&str>).unwrap();
            let show_i = tauri::menu::MenuItem::with_id(app, "show", "Show Player", true, None::<&str>).unwrap();
            let menu = tauri::menu::Menu::with_items(app, &[&show_i, &tauri::menu::PredefinedMenuItem::separator(app).unwrap(), &quit_i]).unwrap();

            let _tray = tauri::tray::TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "quit" => app.exit(0),
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)
                .unwrap();

            // Restore or snap window on startup
            if let Some(window) = app.get_webview_window("main") {
                let main_window = window.clone();
                
                // --- Close to Tray Logic ---
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = main_window.hide();
                    }
                });

                let state_path = get_window_state_path(app.handle());
                let mut restored = false;

                if let Some(ref path) = state_path {
                    if let Ok(data) = fs::read_to_string(path) {
                        if let Ok(ws) = serde_json::from_str::<WindowState>(&data) {
                            // Validate that saved position is on a current monitor
                            if is_position_valid_on_monitors(&window, ws.x, ws.y) {
                                // If the app was last closed while a panel was still
                                // expanded, ws.y is the top of that taller window, not
                                // the collapsed resting position. Expand/collapse always
                                // preserves the bottom edge, so re-derive the correct
                                // collapsed y from it instead of trusting ws.y directly.
                                let scale_factor = scale_factor_at_position(&window, ws.x, ws.y);
                                let collapsed_height_phys = (PANEL_COLLAPSED_HEIGHT * scale_factor).round() as i32;
                                // Clamp before casting: ws.height comes from a JSON file that
                                // could be hand-edited or corrupted, and an out-of-range value
                                // would otherwise wrap on the u32->i32 cast.
                                let safe_height = ws.height.min(i32::MAX as u32) as i32;
                                let bottom = ws.y.saturating_add(safe_height);
                                let corrected_y = bottom.saturating_sub(collapsed_height_phys);

                                // Re-validate: the correction above can move the position off
                                // every monitor if ws.height was stale/corrupted, in which case
                                // fall through to the OS-specific snap-to-corner logic below
                                // instead of restoring the window somewhere invisible.
                                if is_position_valid_on_monitors(&window, ws.x, corrected_y) {
                                    let _ = window.set_position(tauri::Position::Physical(
                                        tauri::PhysicalPosition::new(ws.x, corrected_y)
                                    ));
                                    // Do NOT restore size from state to ensure the fixed shape is applied
                                    let _ = window.set_size(tauri::Size::Logical(
                                        tauri::LogicalSize::new(WINDOW_WIDTH, PANEL_COLLAPSED_HEIGHT)
                                    ));
                                    restored = true;
                                }
                            }
                        }
                    }
                }

                #[cfg(target_os = "windows")]
                if !restored {
                    // Windows: snap to bottom-left taskbar area
                    if let Ok(Some(monitor)) = window.primary_monitor() {
                        let full_size = monitor.size();
                        let work_area = monitor.work_area();
                        let sf = monitor.scale_factor();
                        
                        let win_h = (PANEL_COLLAPSED_HEIGHT * sf) as f64;
                        let taskbar_h = (full_size.height as i32 - work_area.size.height as i32).abs() as f64;
                        
                        let padding = (12.0 * sf) as f64;
                        let x = padding as i32;
                        let y = (full_size.height as f64 - win_h - taskbar_h - padding) as i32;
                        
                        let _ = window.set_position(tauri::Position::Physical(
                            tauri::PhysicalPosition::new(x, y)
                        ));
                    }
                }

                #[cfg(not(target_os = "windows"))]
                if !restored {
                    // macOS/Linux: snap to top-right (near Menu Bar)
                    if let Ok(Some(monitor)) = window.primary_monitor() {
                        let full_size = monitor.size();
                        let sf = monitor.scale_factor();
                        let win_w = (WINDOW_WIDTH * sf) as f64;
                        let padding = (20.0 * sf) as f64;
                        
                        let x = (full_size.width as f64 - win_w - padding) as i32;
                        let y = padding as i32;
                        
                        let _ = window.set_position(tauri::Position::Physical(
                            tauri::PhysicalPosition::new(x, y)
                        ));
                    }
                }

                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.set_always_on_top(true);

                // Listen to move/resize events and save state immediately in Rust
                let save_path = state_path.clone();
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    let path = match &save_path { Some(p) => p, None => return };
                    match event {
                        tauri::WindowEvent::Moved(pos) => {
                            if let Ok(size) = window_clone.outer_size() {
                                persist_window_state(path, pos.x, pos.y, size.width, size.height);
                            }
                        }
                        tauri::WindowEvent::Resized(size) => {
                            if let Ok(pos) = window_clone.outer_position() {
                                persist_window_state(path, pos.x, pos.y, size.width, size.height);
                            }
                        }
                        _ => {}
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_access_token, authorize, spotify_fetch, exit_app, update_media_session, logout, snap_to_corner, save_window_state, load_window_state, focus_window, set_panel_expanded])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // --- WindowState serialization ---
    #[test]
    fn test_window_state_serializes_correctly() {
        let ws = WindowState { x: 100, y: 200, width: 340, height: 48 };
        let json = serde_json::to_string(&ws).unwrap();
        assert!(json.contains("\"x\":100"));
        assert!(json.contains("\"y\":200"));
        assert!(json.contains("\"width\":340"));
        assert!(json.contains("\"height\":48"));
    }

    #[test]
    fn test_window_state_deserializes_correctly() {
        let json = r#"{"x":50,"y":900,"width":280,"height":40}"#;
        let ws: WindowState = serde_json::from_str(json).unwrap();
        assert_eq!(ws.x, 50);
        assert_eq!(ws.y, 900);
        assert_eq!(ws.width, 280);
        assert_eq!(ws.height, 40);
    }

    #[test]
    fn test_window_state_roundtrip() {
        let original = WindowState { x: -10, y: 1080, width: 400, height: 60 };
        let json = serde_json::to_string(&original).unwrap();
        let restored: WindowState = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.x, original.x);
        assert_eq!(restored.y, original.y);
        assert_eq!(restored.width, original.width);
        assert_eq!(restored.height, original.height);
    }

    #[test]
    fn test_window_state_invalid_json_returns_none() {
        let bad_json = r#"{"x": "not_a_number"}"#;
        let result: Option<WindowState> = serde_json::from_str(bad_json).ok();
        assert!(result.is_none());
    }

    // --- persist_window_state writes to disk ---
    #[test]
    fn test_persist_window_state_writes_file() {
        let dir = std::env::temp_dir();
        let path = dir.join("tauri_widget_test_state.json");
        persist_window_state(&path, 10, 20, 300, 50);
        assert!(path.exists());
        let content = fs::read_to_string(&path).unwrap();
        let ws: WindowState = serde_json::from_str(&content).unwrap();
        assert_eq!(ws.x, 10);
        assert_eq!(ws.y, 20);
        assert_eq!(ws.width, 300);
        assert_eq!(ws.height, 50);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_persist_window_state_overwrites_existing() {
        let dir = std::env::temp_dir();
        let path = dir.join("tauri_widget_test_overwrite.json");
        persist_window_state(&path, 1, 2, 3, 4);
        persist_window_state(&path, 100, 200, 300, 400);
        let content = fs::read_to_string(&path).unwrap();
        let ws: WindowState = serde_json::from_str(&content).unwrap();
        assert_eq!(ws.x, 100);
        assert_eq!(ws.width, 300);
        let _ = fs::remove_file(&path);
    }

    // --- generate_random_string ---
    #[test]
    fn test_random_string_correct_length() {
        // The base64 encoding of N random bytes produces ceil(N*4/3) chars
        let s = generate_random_string(32);
        assert!(!s.is_empty());
        assert!(s.len() >= 32); // base64 is always >= input length
    }

    #[test]
    fn test_random_string_is_unique() {
        let a = generate_random_string(64);
        let b = generate_random_string(64);
        assert_ne!(a, b, "Two random strings should never be equal");
    }

    #[test]
    fn test_random_string_url_safe_chars() {
        let s = generate_random_string(128);
        // URL_SAFE_NO_PAD: only A-Z a-z 0-9 - _
        for ch in s.chars() {
            assert!(
                ch.is_alphanumeric() || ch == '-' || ch == '_',
                "Unexpected char in URL-safe string: {}", ch
            );
        }
    }

    // --- Token expiry logic ---
    #[test]
    fn test_token_is_expired_when_time_past() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
        let tokens = Tokens {
            access_token: "old_token".to_string(),
            refresh_token: Some("refresh".to_string()),
            expires_in: 3600,
            obtained_at: now - 3700, // obtained 3700s ago, expires in 3600s → expired
        };
        let is_expired = now >= tokens.obtained_at + tokens.expires_in - 60;
        assert!(is_expired, "Token should be marked expired");
    }

    #[test]
    fn test_token_is_valid_when_fresh() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
        let tokens = Tokens {
            access_token: "fresh_token".to_string(),
            refresh_token: Some("refresh".to_string()),
            expires_in: 3600,
            obtained_at: now - 10, // just obtained 10s ago
        };
        let is_expired = now >= tokens.obtained_at + tokens.expires_in - 60;
        assert!(!is_expired, "Token should still be valid");
    }

    #[test]
    fn test_token_expires_in_buffer_zone() {
        // Token obtained 3541s ago with 3600s expiry → within 60s buffer → should refresh
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
        let tokens = Tokens {
            access_token: "almost_expired".to_string(),
            refresh_token: Some("refresh".to_string()),
            expires_in: 3600,
            obtained_at: now - 3541,
        };
        let is_expired = now >= tokens.obtained_at + tokens.expires_in - 60;
        assert!(is_expired, "Token in 60s buffer should trigger refresh");
    }

    // --- Config defaults ---
    #[test]
    fn test_config_has_correct_client_id() {
        let cfg = load_config();
        assert_eq!(cfg.client_id, "0f68737f57b7444fb3a39ca14261bbcb");
    }

    #[test]
    fn test_config_redirect_uri_port_matches() {
        let cfg = load_config();
        assert!(cfg.redirect_uri.contains(&cfg.port.to_string()),
            "Redirect URI port should match config port");
    }

    #[test]
    fn test_config_scopes_include_required_permissions() {
        let cfg = load_config();
        assert!(cfg.scopes.contains("user-read-currently-playing"));
        assert!(cfg.scopes.contains("user-modify-playback-state"));
        assert!(cfg.scopes.contains("streaming"));
        assert!(cfg.scopes.contains("user-library-modify"));
    }
}
