# Code Changes Required — Desktop Conversion

Summary of all files added and modified for the Tauri desktop conversion.

---

## New Files

### Documentation
| File | Purpose |
|------|---------|
| `docs/DESKTOP_ARCHITECTURE.md` | Full architecture diagram, schema, services |
| `docs/MIGRATION_PLAN.md` | Phased migration guide |
| `docs/DESKTOP_BUILD.md` | Production build & installer instructions |
| `docs/CODE_CHANGES.md` | This file |

### Tauri Runtime (`src-tauri/`)
| File | Purpose |
|------|---------|
| `Cargo.toml` | Rust dependencies (Tauri v2, plugins) |
| `tauri.conf.json` | Window, bundle, CSP configuration |
| `src/lib.rs` | App builder, spawns desktop-server |
| `src/main.rs` | Entry point |
| `src/commands/mod.rs` | Native commands (notifications, window state) |
| `capabilities/default.json` | Tauri permissions |

### Desktop API Server (`desktop-server/`)
| File | Purpose |
|------|---------|
| `src/index.ts` | Hono HTTP server entry |
| `src/db/schema.ts` | Drizzle SQLite schema |
| `src/db/client.ts` | Database connection |
| `src/db/migrate.ts` | Migration runner |
| `src/db/seed.ts` | Seed from db.json + bcrypt migration |
| `src/db/documentStore.ts` | Firestore-compatible document ops |
| `src/services/storageService.ts` | App data paths, directory init |
| `src/services/uploadService.ts` | File upload, validation, indexing |
| `src/services/authService.ts` | bcrypt auth, sessions |
| `src/services/backupService.ts` | ZIP backup/restore |
| `src/services/exportService.ts` | CSV/Excel/JSON export |
| `src/services/settingsService.ts` | settings.json management |
| `src/routes/*.ts` | API route handlers |
| `drizzle/0000_initial.sql` | Initial SQLite migration |

### Frontend Desktop Layer
| File | Purpose |
|------|---------|
| `src/lib/platform.ts` | Web vs desktop detection |
| `src/lib/apiClient.ts` | Unified API routing |
| `src/stores/settingsStore.ts` | Zustand settings store |
| `src/components/desktop-provider.jsx` | Desktop runtime initialization |
| `scripts/build-desktop-server.mjs` | esbuild bundler for production |

---

## Modified Files

| File | Change |
|------|--------|
| `package.json` | Desktop deps (Tauri, Drizzle, Hono, Zustand, bcrypt, etc.) + scripts |
| `next.config.mjs` | Static export when `DESKTOP_BUILD=1` |
| `src/lib/mockFirestore.js` | Routes through `apiClient` instead of hardcoded fetch |
| `src/lib/mockStorage.js` | Routes through `apiClient` |
| `src/config/api.js` | Dynamic base URL via `getApiBaseUrl()` |
| `src/app/layout.js` | Wraps app in `DesktopProvider` |

---

## Unchanged (Preserved)

- All dashboard pages (`src/app/dashboard/**`)
- `FirestoreService` (`src/services/firestoreService.js`)
- All UI components (`src/components/**`)
- 3D viewer (`src/components/3d/**`)
- Role-based routing (`role-guard.jsx`, `role-routes.js`)
- Theme system, FAQ, help components
- Web API routes (`src/app/api/**`) — still work for `npm run dev`

---

## Architecture Decision: Dual Runtime

The app runs in two modes without code forks:

```
Web (npm run dev)          Desktop (cargo tauri dev)
├── Next.js API routes     ├── Hono desktop-server
├── data/db.json           ├── SQLite database.db
└── public/uploads/        └── {AppData}/uploads/
```

Both modes share the same frontend code via `apiClient.ts` platform abstraction.
