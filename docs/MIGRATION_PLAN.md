# Vision365 Desktop Migration Plan

Phased migration from Next.js web app to offline Tauri desktop app **without removing any functionality**.

---

## Phase 0: Prerequisites

### Install Tools

```bash
# Rust (required for Tauri)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Tauri CLI
cargo install tauri-cli --version "^2.0"

# Windows only: WebView2 (usually pre-installed on Windows 10/11)
# macOS: Xcode Command Line Tools
# Linux: sudo apt install libwebkit2gtk-4.1-dev build-essential
```

### Install Dependencies

```bash
npm install
```

---

## Phase 1: Foundation (Current Implementation)

**Goal:** Tauri shell + local API server + SQLite replacing `db.json`

### Completed / In Progress

- [x] Architecture documentation
- [x] `desktop-server/` with Hono + Drizzle + SQLite
- [x] `src-tauri/` Tauri v2 configuration
- [x] Platform abstraction (`platform.ts`, `apiClient.ts`)
- [x] Updated `mockFirestore.js` and `mockStorage.js`
- [x] Local auth with bcrypt migration
- [x] Backup and export services
- [x] Zustand settings store

### Verify Phase 1

```bash
npm run desktop:dev
```

1. App launches in Tauri window
2. Login with `admin@vision365.com` / `admin123`
3. All dashboard pages load
4. Create community, building, upload asset — data persists after restart
5. Check `%APPDATA%/Vision365/database/database.db` exists

---

## Phase 2: Storage Migration

**Goal:** Move uploads from `public/` to app data directory

### Steps

1. On first desktop launch, copy `public/uploads/` → `{AppData}/uploads/`
2. Copy `public/floor-plans/` → `{AppData}/floor-plans/`
3. Update `uploadService` to serve files via `asset://` or local HTTP static route
4. Update image URLs in existing data (migration script in `desktop-server/src/db/migrateUrls.ts`)

### Verify

- Floor plan images display on community-overview
- Asset custom images load correctly
- 3D models load from bundled `public/asset/models/`

---

## Phase 3: Authentication Hardening

**Goal:** Production-ready local auth

### Steps

1. Migrate all `UserDB` passwords to bcrypt hashes in SQLite `users` table
2. Remove plaintext password comparison from `login-form.jsx`
3. Add PIN lock screen (optional, settings-driven)
4. Session expiry and refresh
5. "Remember me" via secure local storage

### Verify

- Login fails with wrong password
- Password not visible in database file (only hash)
- Session persists across restarts when "Remember me" enabled

---

## Phase 4: Backup & Export

**Goal:** Full backup/restore and data export

### Steps

1. Add backup UI in settings (or dashboard admin panel)
2. Wire manual backup button to `POST /api/backup/create`
3. Wire restore to `POST /api/backup/restore`
4. Add export buttons on list pages (CSV/Excel)

### Verify

- Create backup ZIP → contains database.db, uploads/, settings/
- Delete app data → restore from ZIP → all data recovered
- Export buildings list to CSV

---

## Phase 5: Native Desktop Features

**Goal:** Window management, notifications, file picker

### Steps

1. Window size/position restored on launch (Tauri + settings)
2. Native notifications for alarms (community-overview)
3. Native file picker for asset uploads (replaces browser input)
4. System tray (optional)

### Verify

- Resize window → close → reopen → same size/position
- Alarm triggers native notification
- "Browse" button opens OS file picker

---

## Phase 6: Production Build

**Goal:** Signed installers for all platforms

### Windows

```bash
npm run desktop:build:windows
# Output: src-tauri/target/release/bundle/msi/Vision365_0.1.0_x64_en-US.msi
```

Requirements:
- Code signing certificate (optional but recommended)
- WebView2 runtime

### macOS

```bash
npm run desktop:build:macos
# Output: src-tauri/target/release/bundle/dmg/Vision365_0.1.0_x64.dmg
```

Requirements:
- Apple Developer ID for notarization
- `codesign` and `notarytool`

### Linux

```bash
npm run desktop:build:linux
# Output: .deb and/or .AppImage in src-tauri/target/release/bundle/
```

---

## Phase 7: Auto-Update (Future)

**Goal:** Seamless updates without data loss

### Steps

1. Enable `tauri-plugin-updater`
2. Host update manifest on release server
3. Sign update bundles
4. Verify migrations run before UI loads

### Data Safety Guarantee

```
App Bundle (replaceable)     App Data (never touched by updater)
├── vision365.exe            ├── database/database.db
├── desktop-server.js        ├── uploads/
└── public/assets/           ├── settings/
                             └── backups/
```

---

## Code Changes Summary

| File | Change |
|------|--------|
| `src/lib/mockFirestore.js` | Use `apiClient` instead of hardcoded `/api/db` |
| `src/lib/mockStorage.js` | Use `apiClient` for upload/delete |
| `src/config/api.js` | Dynamic base URL from `apiClient` |
| `src/components/login-form.jsx` | Desktop auth via `/api/auth/login` |
| `next.config.mjs` | `output: 'export'` for desktop builds |
| `package.json` | Desktop scripts, new dependencies |
| `data/db.json` | Seed source only; desktop uses SQLite |

### Unchanged (Preserved)

- All dashboard pages and UI components
- `FirestoreService` domain logic
- 3D viewer components
- shadcn/ui components
- Role-based routing
- FAQ, help, theme system

---

## Rollback Plan

If desktop migration fails, the web version continues to work:

```bash
npm run dev    # Standard Next.js with db.json
```

The `platform.ts` abstraction ensures web and desktop coexist.

---

## Step-by-Step Implementation Guide

### Day 1: Environment Setup
1. Install Rust, Tauri CLI, platform dependencies
2. Run `npm install`
3. Run `npm run desktop:dev` — verify Tauri window opens

### Day 2: Data Layer
1. Verify SQLite database created in app data
2. Test CRUD via existing UI (communities, buildings)
3. Compare data in SQLite vs original `db.json`

### Day 3: File Storage
1. Test image upload on assets page
2. Test floor plan upload
3. Verify files in `{AppData}/uploads/`

### Day 4: Auth & Security
1. Test login/logout
2. Verify bcrypt hashes in database
3. Test session persistence

### Day 5: Backup & Export
1. Create manual backup
2. Test restore
3. Export data to CSV/Excel

### Day 6-7: Polish & Build
1. Window state persistence
2. Native notifications
3. Production builds for target platforms
4. Installer testing on clean machines
