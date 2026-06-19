# Vision365 Minimal

A minimal Next.js version of Vision365 with the same UI for:

- Community pages (add community, assign buildings to community)
- Buildings pages (add buildings, assign to users, edit building status)
- Community Overview dashboard
- Floor map pages (configure, view, edit)
- Asset pages (upload, create, map, view, details)

**Admin-only login** — no Firebase. All data is stored in a single JSON file: `data/db.json`.

## Default admin credentials

- Email: `admin@vision365.com`
- Password: `admin123`

## Getting started

### Web (development)

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Desktop (Tauri — offline)

Requires [Rust](https://rustup.rs) and Tauri CLI v2.

```bash
npm install
cd src-tauri && cargo tauri dev
```

See [docs/DESKTOP_BUILD.md](docs/DESKTOP_BUILD.md) for production builds and installers.
See [docs/DESKTOP_ARCHITECTURE.md](docs/DESKTOP_ARCHITECTURE.md) for full architecture.

## Data storage

- **Database**: `data/db.json` — communities, buildings, assets, floor maps, alarms, users
- **File uploads**: `public/uploads/` — floor plan images and asset documents

All changes made in the app are persisted to `data/db.json` via `/api/db`.

## Project structure

```
vision365-minimal/
├── data/db.json              # Single JSON database
├── public/uploads/           # Uploaded images/files
├── src/
│   ├── app/api/db/           # JSON database API
│   ├── app/api/upload/       # File upload API
│   ├── lib/mockFirestore.js  # Firebase Firestore replacement
│   ├── lib/mockStorage.js    # Firebase Storage replacement
│   ├── contexts/AppContext.jsx
│   └── app/dashboard/        # Dashboard pages
```

## Routes

| Route | Description |
|-------|-------------|
| `/` | Admin login |
| `/dashboard/community` | Add / manage communities |
| `/dashboard/community/assign` | Assign buildings to communities |
| `/dashboard/buildings` | Add new buildings |
| `/dashboard/buildings/assign_buildings` | Assign buildings to users |
| `/dashboard/buildings/edit_status` | Edit building list & status |
| `/dashboard/buildings/edit_status/[name]` | Edit single building details |
| `/dashboard/community-overview` | Community dashboard |
| `/dashboard/floor_configuration` | Create floor maps |
| `/dashboard/floor_configuration/view` | View floor maps |
| `/dashboard/floor_configuration/edit` | Edit floor maps |
| `/dashboard/assets` | Upload assets |
| `/dashboard/assets/create` | Create building assets |
| `/dashboard/assets/map_assets` | Map assets to buildings |
| `/dashboard/assets/view` | View/edit building assets |
| `/dashboard/assets/view/details` | Asset detail page |
