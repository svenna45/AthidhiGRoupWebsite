import hashlib
import os
from datetime import datetime, timezone
from pathlib import Path

import pathspec
from bson import json_util

from secret_scan import is_binary

WORKSPACE = Path(os.environ["WORKSPACE_ROOT"]).resolve()
UPLOAD_DIR = Path(os.environ["UPLOAD_DIR"]).resolve()
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALWAYS_SKIP_DIRS = {"node_modules", ".git", "build", "dist", "__pycache__", ".venv", "venv", ".pytest_cache", ".mypy_cache", ".emergent", "coverage"}
ALWAYS_SKIP_FILES = {"yarn.lock", "package-lock.json"}
MD_EXT = {".md", ".mdx"}
CODE_EXT = {".py", ".js", ".jsx", ".ts", ".tsx", ".css", ".html", ".sh", ".sql"}
CONFIG_EXT = {".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".txt", ".env.example", ".gitignore"}
GENERATED_DIRS = ("memory/", "test_reports/", "tests/")
MAX_TREE_FILE = 100 * 1024 * 1024
LARGE_WARN = 5 * 1024 * 1024
HARD_MAX = 95 * 1024 * 1024
PROTECTED_COLLECTIONS = {"gh_settings"}
HIDDEN_COLLECTIONS = {"gh_settings", "cms_content"}
CMS_COLLECTION = "cms_content"


def slugify(text: str) -> str:
    import re
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").strip().lower()).strip("-")
    return s or "untitled"


def render_cms(doc: dict) -> tuple[str, bytes]:
    slug = doc.get("slug") or slugify(doc.get("title", "untitled"))
    fm = (
        "---\n"
        f"title: {doc.get('title', '')}\n"
        f"slug: {slug}\n"
        f"type: {doc.get('type', 'doc')}\n"
        f"status: {doc.get('status', 'draft')}\n"
        f"updated_at: {doc.get('updated_at', '')}\n"
        "---\n\n"
    )
    body = doc.get("body", "") or ""
    return f"content/{slug}.md", (fm + body).encode("utf-8")


def _load_gitignore() -> pathspec.PathSpec:
    lines = ["**/.env", "**/.env.*", "!**/.env.example", "*.log", "*.pem", "*.key", "**/uploads/"]
    for gi in WORKSPACE.rglob(".gitignore"):
        if any(part in ALWAYS_SKIP_DIRS for part in gi.relative_to(WORKSPACE).parts):
            continue
        prefix = gi.parent.relative_to(WORKSPACE).as_posix()
        for raw in gi.read_text(errors="ignore").splitlines():
            s = raw.strip()
            if not s or s.startswith("#"):
                continue
            if prefix != ".":
                neg = s.startswith("!")
                body = s[1:] if neg else s
                body = f"{prefix}/{body.lstrip('/')}" if (body.startswith("/") or "/" in body.rstrip("/")) else f"{prefix}/**/{body}"
                s = ("!" if neg else "") + body
            lines.append(s)
    return pathspec.PathSpec.from_lines("gitwildmatch", lines)


def category(rel: str) -> str:
    if rel.startswith(GENERATED_DIRS) or rel == "design_guidelines.json" or rel == "test_result.md":
        return "generated"
    ext = Path(rel).suffix.lower()
    if ext in MD_EXT:
        return "markdown"
    if ext in CODE_EXT:
        return "code"
    if ext in CONFIG_EXT or Path(rel).name in {"Dockerfile", ".gitignore", "requirements.txt"}:
        return "config"
    return "other"


def list_workspace() -> list[dict]:
    spec = _load_gitignore()
    out = []
    for root, dirs, files in os.walk(WORKSPACE):
        rel_root = Path(root).relative_to(WORKSPACE)
        dirs[:] = sorted(d for d in dirs if d not in ALWAYS_SKIP_DIRS and not spec.match_file((rel_root / d).as_posix() + "/") and Path(root, d).resolve() != UPLOAD_DIR)
        for f in sorted(files):
            if f in ALWAYS_SKIP_FILES:
                continue
            rel = (rel_root / f).as_posix().removeprefix("./")
            if spec.match_file(rel):
                continue
            p = Path(root, f)
            try:
                size = p.stat().st_size
            except OSError:
                continue
            if size > MAX_TREE_FILE:
                continue
            out.append({"path": rel, "size": size, "category": category(rel)})
    return out


def read_workspace_file(rel: str) -> bytes:
    p = (WORKSPACE / rel).resolve()
    if not p.is_relative_to(WORKSPACE) or not p.is_file():
        raise ValueError(f"Invalid workspace path: {rel}")
    if any(part in ALWAYS_SKIP_DIRS for part in p.relative_to(WORKSPACE).parts):
        raise ValueError(f"Path not allowed: {rel}")
    spec = _load_gitignore()
    if spec.match_file(p.relative_to(WORKSPACE).as_posix()):
        raise ValueError(f"Path is git-ignored (never pushed): {rel}")
    return p.read_bytes()


def safe_upload_name(name: str) -> str:
    name = Path(name).name.replace("\\", "_")
    if not name or name.startswith("."):
        raise ValueError("Invalid upload filename")
    return name


def list_uploads() -> list[dict]:
    return [{"name": p.name, "size": p.stat().st_size, "uploaded_at": datetime.fromtimestamp(p.stat().st_mtime, tz=timezone.utc).isoformat()} for p in sorted(UPLOAD_DIR.iterdir()) if p.is_file()]


def read_upload(name: str) -> bytes:
    return (UPLOAD_DIR / safe_upload_name(name)).read_bytes()


async def list_collections(db) -> list[dict]:
    names = sorted(n for n in await db.list_collection_names() if n not in HIDDEN_COLLECTIONS)
    return [{"name": n, "count": await db[n].estimated_document_count()} for n in names]


async def snapshot_collection(db, name: str, ts: str) -> tuple[str, bytes]:
    if name in PROTECTED_COLLECTIONS:
        raise ValueError(f"Collection {name} is protected and can never be exported")
    docs = await db[name].find({}).to_list(length=None)
    payload = {"database": db.name, "collection": name, "exported_at": ts, "count": len(docs), "documents": docs}
    return f"backups/{name}/{name}_{ts.replace(':', '').replace('-', '')[:15]}.json", json_util.dumps(payload, indent=2).encode()


def git_blob_sha(data: bytes) -> str:
    h = hashlib.sha1()
    h.update(f"blob {len(data)}\0".encode())
    h.update(data)
    return h.hexdigest()


def size_warning(path: str, size: int) -> dict | None:
    if size > HARD_MAX:
        return {"path": path, "level": "error", "message": f"{size / 1e6:.1f} MB exceeds GitHub's 100 MB blob limit. Compress it or use Git LFS."}
    if size > LARGE_WARN:
        return {"path": path, "level": "warn", "message": f"{size / 1e6:.1f} MB is large for API pushes — consider compressing or Git LFS."}
    return None


__all__ = ["is_binary"]
