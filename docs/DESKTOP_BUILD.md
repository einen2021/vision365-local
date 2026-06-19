# Vision365 Desktop — Build Instructions

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20+ | https://nodejs.org |
| Rust | 1.77+ | https://rustup.rs |
| Tauri CLI | 2.x | `cargo install tauri-cli --version "^2.0"` |

### Platform-Specific

**Windows**
- Microsoft C++ Build Tools
- WebView2 (pre-installed on Windows 10/11)

**macOS**
```bash
xcode-select --install
```

**Linux (Debian/Ubuntu)**
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

---

## Development

```bash
# Install dependencies
npm install

# Generate Tauri icons (first time only)
# Place a 1024x1024 PNG at public/icon.png, then:
npm run tauri icon ../public/favicon.ico

# Start desktop app in development mode
cd src-tauri && cargo tauri dev
```

This will:
1. Start Next.js dev server on `http://localhost:3000`
2. Spawn the local API server (SQLite + file storage)
3. Open the Tauri window

Alternative (manual):
```bash
npm run desktop:dev
```

---

## Production Build

### All Platforms
```bash
npm run desktop:build
```

### Windows Installer (.msi / .exe)
```bash
npm run desktop:build:windows
```
Output: `src-tauri/target/release/bundle/msi/Vision365_0.1.0_x64_en-US.msi`

### macOS Installer (.dmg)
```bash
npm run desktop:build:macos
```
Output: `src-tauri/target/release/bundle/dmg/Vision365_0.1.0_aarch64.dmg`

For Intel Macs, use target `x86_64-apple-darwin`.

### Linux Packages (.deb / .AppImage)
```bash
npm run desktop:build:linux
```
Output: `src-tauri/target/release/bundle/deb/` and `appimage/`

---

## App Data Locations

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%\Vision365\` |
| macOS | `~/Library/Application Support/Vision365/` |
| Linux | `~/.config/Vision365/` |

Contents:
```
Vision365/
├── database/database.db    # SQLite database
├── uploads/                # User uploads
├── floor-plans/            # Floor plan images
├── backups/                # ZIP backups
├── exports/                # CSV/Excel/JSON exports
└── settings/settings.json  # App preferences
```

---

## Code Signing (Production)

### Windows
Set in `src-tauri/tauri.conf.json`:
```json
"windows": {
  "certificateThumbprint": "YOUR_CERT_THUMBPRINT",
  "digestAlgorithm": "sha256",
  "timestampUrl": "http://timestamp.digicert.com"
}
```

### macOS
```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name"
export APPLE_ID="your@email.com"
export APPLE_PASSWORD="app-specific-password"
npm run desktop:build:macos
```

---

## Auto-Update (Future)

The architecture preserves user data outside the app bundle. To enable updates:

1. Add `tauri-plugin-updater` to `Cargo.toml`
2. Configure update endpoint in `tauri.conf.json`
3. Sign update bundles with the same certificate

User data in `{AppData}/Vision365/` is never modified by updates.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `better-sqlite3` build fails | Install build tools (VS Build Tools on Windows) |
| WebView2 missing | Install from Microsoft |
| API connection refused | Check desktop-server logs in terminal |
| Blank window on start | Wait for API port event; check CSP in tauri.conf.json |
| Database locked | Close other instances of the app |
