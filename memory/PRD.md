# GitHub Sync — Product Requirements

## Original problem statement
Single-user web app (React + FastAPI + MongoDB) that pushes app-generated files, code/config,
DB snapshots and markdown docs to a GitHub repo via a Personal Access Token. Conflicts are handled
through a branch + PR instead of overwriting.

## Core requirements
- Push scheduling: Manual only.
- Sources: Workspace/Mongo files + UI drag-and-drop uploads + **in-app CMS content** (create/edit).
- PRs on conflict: Always leave for manual review (never overwrite).
- Hardening: Secret scanning before push, timestamped DB snapshots, PAT encrypted via Fernet in DB.

## Architecture
- Backend: FastAPI (`server.py`), `models.py`, `github_client.py`, `secret_scan.py`, `sources.py`.
  - GitHub REST via httpx; Fernet-encrypted PAT in `gh_settings`.
  - Mongo collections: `gh_settings` (protected/hidden), `push_history`, `cms_content` (hidden from DB-snapshot list).
- Frontend: React SPA. `App.js` orchestrates; components: Header, ConnectPanel, SourcePicker
  (Workspace / Content / DB / Uploads tabs), FileTree, CmsTab, PreviewPanel, DiffView, HistoryTable.

## Implemented (2026-06)
- Full scaffolding verified & booted. Deps (cryptography, httpx) present.
- **Fixed blocker**: react-refresh/babel "Maximum call stack size exceeded" on the recursive
  `Dir` component in `FileTree.jsx` — resolved via `const DirNode = Dir` indirection for the
  self-render.
- **CMS module (new)**: create/edit/delete markdown content in-app; entries selectable as a push
  source and rendered to `content/<slug>.md` (YAML frontmatter: title/slug/type/status/updated_at).
  - Backend: `CmsContent`/`CmsContentIn` models, `/api/cms` CRUD, unique slug, `render_cms` in sources,
    `Selection.cms_ids` wired into `collect_files`.
  - Frontend: `CmsTab.jsx` + Content tab in SourcePicker; selection flows into preview/push payload.

## Pending / backlog
- P0: End-to-end GitHub push testing (needs user PAT + repo/branch) — user deferred ("test later").
- P1: Verify direct-commit vs conflict branch+PR flow with real credentials.
- P2: Markdown preview toggle in the CMS editor; richer content types.

## Notes
- No auth in this app (single-user). No test_credentials needed.
- GitHub PAT provided by user at runtime, encrypted with FERNET_KEY (backend/.env).
