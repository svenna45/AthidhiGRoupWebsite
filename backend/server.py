import asyncio
import difflib
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import List

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from cryptography.fernet import Fernet, InvalidToken  # noqa: E402
from fastapi import APIRouter, FastAPI, File, HTTPException, UploadFile  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from bson import ObjectId  # noqa: E402
from bson.errors import InvalidId  # noqa: E402
from starlette.middleware.cors import CORSMiddleware  # noqa: E402

import sources  # noqa: E402
from github_client import GitHub, gh_error, rate_limit  # noqa: E402
from models import CmsContent, CmsContentIn, ConfigIn, HistoryFile, PushHistory, Selection, TokenIn  # noqa: E402
from secret_scan import is_binary, scan  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("github-sync")

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]
fernet = Fernet(os.environ["FERNET_KEY"].encode())

app = FastAPI(title="GitHub Sync")
api = APIRouter(prefix="/api")

SETTINGS_ID = "github"


async def get_settings() -> dict:
    return await db.gh_settings.find_one({"_id": SETTINGS_ID}) or {"_id": SETTINGS_ID}


async def save_settings(patch: dict):
    await db.gh_settings.update_one({"_id": SETTINGS_ID}, {"$set": patch}, upsert=True)


async def get_token(settings: dict | None = None) -> str:
    settings = settings or await get_settings()
    ct = settings.get("token_ct")
    if not ct:
        raise HTTPException(400, {"code": "not_connected", "message": "GitHub is not connected. Add a Personal Access Token first."})
    try:
        return fernet.decrypt(ct.encode()).decode()
    except InvalidToken:
        raise HTTPException(500, {"code": "decrypt_failed", "message": "Stored token cannot be decrypted (FERNET_KEY changed?). Reconnect."})


def public_settings(s: dict) -> dict:
    return {
        "connected": bool(s.get("token_ct")),
        "login": s.get("login"),
        "avatar_url": s.get("avatar_url"),
        "repo": s.get("repo"),
        "branch": s.get("branch"),
        "baselines": s.get("baselines", {}),
        "rate_limit": rate_limit.as_dict(),
    }


def require_repo(s: dict) -> tuple[str, str]:
    if not s.get("repo") or not s.get("branch"):
        raise HTTPException(400, {"code": "no_repo", "message": "Select a target repository and branch first."})
    return s["repo"], s["branch"]


# ---------------- connection ----------------
@api.get("/github/status")
async def status():
    return public_settings(await get_settings())


@api.post("/github/connect")
async def connect(body: TokenIn):
    async with GitHub(body.token) as gh:
        user = await gh.user()
    await save_settings({"token_ct": fernet.encrypt(body.token.encode()).decode(), "login": user["login"], "avatar_url": user.get("avatar_url")})
    logger.info("GitHub connected as %s", user["login"])
    return public_settings(await get_settings())


@api.delete("/github/disconnect")
async def disconnect():
    await db.gh_settings.update_one({"_id": SETTINGS_ID}, {"$unset": {"token_ct": "", "login": "", "avatar_url": ""}})
    return public_settings(await get_settings())


@api.get("/github/repos")
async def repos():
    async with GitHub(await get_token()) as gh:
        return await gh.repos()


@api.get("/github/branches")
async def branches(repo: str):
    async with GitHub(await get_token()) as gh:
        info = await gh.repo(repo)
        names = await gh.branches(repo)
    return {"branches": names, "default_branch": info.get("default_branch"), "empty": not names}


@api.put("/config")
async def set_config(body: ConfigIn):
    await save_settings({"repo": body.repo, "branch": body.branch})
    return public_settings(await get_settings())


@api.post("/config/baseline")
async def accept_baseline():
    s = await get_settings()
    repo, branch = require_repo(s)
    async with GitHub(await get_token(s)) as gh:
        head = await gh.ref_sha(repo, branch)
    await save_settings({f"baselines.{repo}@{branch}".replace(".", "\u2024"): head} if False else {"baselines": {**s.get("baselines", {}), _bkey(repo, branch): head}})
    return public_settings(await get_settings())


def _bkey(repo: str, branch: str) -> str:
    return f"{repo}@{branch}".replace(".", "\u2024")


# ---------------- sources ----------------
@api.get("/sources/workspace")
async def workspace():
    return await asyncio.to_thread(sources.list_workspace)


@api.get("/sources/collections")
async def collections():
    return await sources.list_collections(db)


@api.get("/sources/uploads")
async def uploads():
    return sources.list_uploads()


@api.post("/sources/uploads")
async def upload(files: List[UploadFile] = File(...)):
    saved = []
    for f in files:
        name = sources.safe_upload_name(f.filename or "file")
        data = await f.read()
        if len(data) > sources.HARD_MAX:
            raise HTTPException(413, {"code": "too_large", "message": f"{name} exceeds the 95 MB limit."})
        (sources.UPLOAD_DIR / name).write_bytes(data)
        saved.append(name)
    return {"saved": saved, "uploads": sources.list_uploads()}


@api.delete("/sources/uploads/{name}")
async def delete_upload(name: str):
    p = sources.UPLOAD_DIR / sources.safe_upload_name(name)
    if p.exists():
        p.unlink()
    return sources.list_uploads()


# ---------------- cms ----------------
def _oid(id: str) -> ObjectId:
    try:
        return ObjectId(id)
    except (InvalidId, TypeError):
        raise HTTPException(404, {"code": "not_found", "message": "Content not found."})


async def _unique_slug(base: str, exclude_id: ObjectId | None = None) -> str:
    slug = sources.slugify(base)
    candidate, n = slug, 1
    while True:
        q = {"slug": candidate}
        if exclude_id:
            q["_id"] = {"$ne": exclude_id}
        if not await db.cms_content.find_one(q):
            return candidate
        n += 1
        candidate = f"{slug}-{n}"


@api.get("/cms")
async def cms_list():
    docs = await db.cms_content.find().sort("updated_at", -1).to_list(500)
    return [CmsContent.from_mongo(d).model_dump() for d in docs]


@api.post("/cms")
async def cms_create(body: CmsContentIn):
    now = datetime.now(timezone.utc).isoformat()
    slug = await _unique_slug(body.slug or body.title)
    doc = CmsContent(title=body.title, slug=slug, type=body.type, status=body.status, body=body.body, created_at=now, updated_at=now)
    res = await db.cms_content.insert_one(doc.to_mongo())
    doc.id = str(res.inserted_id)
    return doc.model_dump()


@api.put("/cms/{id}")
async def cms_update(id: str, body: CmsContentIn):
    oid = _oid(id)
    existing = await db.cms_content.find_one({"_id": oid})
    if not existing:
        raise HTTPException(404, {"code": "not_found", "message": "Content not found."})
    slug = await _unique_slug(body.slug or body.title, exclude_id=oid)
    patch = {"title": body.title, "slug": slug, "type": body.type, "status": body.status, "body": body.body, "updated_at": datetime.now(timezone.utc).isoformat()}
    await db.cms_content.update_one({"_id": oid}, {"$set": patch})
    return CmsContent.from_mongo({**existing, **patch}).model_dump()


@api.delete("/cms/{id}")
async def cms_delete(id: str):
    await db.cms_content.delete_one({"_id": _oid(id)})
    return {"deleted": id}


# ---------------- preview / push ----------------
class LocalFile:
    def __init__(self, path: str, data: bytes, source: str):
        self.path, self.data, self.source = path, data, source
        self.sha = sources.git_blob_sha(data)
        self.binary = is_binary(data)
        self.remote_sha = None
        self.status = "added"


async def collect_files(sel: Selection) -> list[LocalFile]:
    if not (sel.workspace_paths or sel.upload_names or sel.collections or sel.cms_ids):
        raise HTTPException(400, {"code": "empty_selection", "message": "Select at least one file, upload, collection or content entry."})
    ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
    files: list[LocalFile] = []
    try:
        for rel in dict.fromkeys(sel.workspace_paths):
            files.append(LocalFile(rel, await asyncio.to_thread(sources.read_workspace_file, rel), "workspace"))
        for name in dict.fromkeys(sel.upload_names):
            files.append(LocalFile(f"uploads/{sources.safe_upload_name(name)}", sources.read_upload(name), "upload"))
        for coll in dict.fromkeys(sel.collections):
            path, data = await sources.snapshot_collection(db, coll, ts)
            files.append(LocalFile(path, data, "snapshot"))
        for cid in dict.fromkeys(sel.cms_ids):
            doc = await db.cms_content.find_one({"_id": _oid(cid)})
            if not doc:
                raise ValueError(f"Content entry {cid} no longer exists")
            path, data = sources.render_cms(doc)
            files.append(LocalFile(path, data, "cms"))
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(400, {"code": "bad_source", "message": str(e)})
    return files


def decide_mode(baseline: str | None, head: str | None, files: list[LocalFile]) -> tuple[str, str]:
    if head is None:
        return "direct", "Repository/branch is empty — it will be initialized and committed directly."
    if baseline == head:
        return "direct", "Remote HEAD matches your last push — will commit directly to the base branch."
    if baseline is None:
        if any(f.status == "modified" for f in files):
            return "pr", "No push baseline yet and some files would overwrite remote content — routing to a branch + PR."
        return "direct", "First push: only new files are added, nothing on the remote is overwritten."
    return "pr", "Remote HEAD changed since your last push — routing to a new branch + PR (never overwriting)."


async def analyze(gh: GitHub, repo: str, branch: str, files: list[LocalFile], s: dict, with_diffs: bool):
    head = await gh.ref_sha(repo, branch)
    remote: dict[str, str] = {}
    if head:
        commit = await gh.commit(repo, head)
        remote = await gh.tree(repo, commit["tree"]["sha"])
    for f in files:
        f.remote_sha = remote.get(f.path)
        f.status = "unchanged" if f.remote_sha == f.sha else ("modified" if f.remote_sha else "added")
    findings = [x for f in files for x in scan(f.path, f.data)]
    warnings = [w for f in files if (w := sources.size_warning(f.path, len(f.data)))]
    baseline = s.get("baselines", {}).get(_bkey(repo, branch))
    mode, reason = decide_mode(baseline, head, files)
    diffs = {}
    if with_diffs:
        async def one(f: LocalFile):
            if f.binary or f.status == "unchanged" or len(f.data) > 512_000:
                return
            old = (await gh.blob(repo, f.remote_sha)) if f.status == "modified" else b""
            if is_binary(old):
                return
            lines = list(difflib.unified_diff(old.decode("utf-8", "replace").splitlines(), f.data.decode("utf-8", "replace").splitlines(), "a/" + f.path, "b/" + f.path, lineterm="", n=3))
            diffs[f.path] = lines[:600]
        await asyncio.gather(*(one(f) for f in files))
    return {
        "repo": repo, "base_branch": branch, "remote_head": head, "baseline": baseline, "predicted_mode": mode, "reason": reason,
        "files": [{"path": f.path, "status": f.status, "source": f.source, "size": len(f.data), "binary": f.binary, "diff": diffs.get(f.path)} for f in files],
        "summary": {k: sum(1 for f in files if f.status == k) for k in ("added", "modified", "unchanged")},
        "secret_findings": findings, "size_warnings": warnings,
        "blocked": bool(findings) or any(w["level"] == "error" for w in warnings),
        "rate_limit": rate_limit.as_dict(),
    }


@api.post("/push/preview")
async def preview(sel: Selection):
    s = await get_settings()
    repo, branch = require_repo(s)
    files = await collect_files(sel)
    async with GitHub(await get_token(s)) as gh:
        return await analyze(gh, repo, branch, files, s, with_diffs=True)


async def log_history(entry: PushHistory) -> PushHistory:
    res = await db.push_history.insert_one(entry.to_mongo())
    entry.id = str(res.inserted_id)
    return entry


@api.post("/push")
async def push(sel: Selection):
    s = await get_settings()
    repo, branch = require_repo(s)
    files = await collect_files(sel)
    message = sel.message.strip() or f"chore(sync): backup {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}"
    hfiles = lambda: [HistoryFile(path=f.path, status=f.status, source=f.source, size=len(f.data)) for f in files]  # noqa: E731
    entry = PushHistory(repo=repo, base_branch=branch, mode="failed", message=message, file_count=len(files))
    try:
        async with GitHub(await get_token(s)) as gh:
            report = await analyze(gh, repo, branch, files, s, with_diffs=False)
            entry.files = hfiles()
            if report["blocked"]:
                entry.mode, entry.error = "rejected", f"{len(report['secret_findings'])} secret finding(s), {sum(1 for w in report['size_warnings'] if w['level']=='error')} oversize file(s)"
                await log_history(entry)
                raise HTTPException(400, {"code": "rejected", "message": "Push rejected: remove files containing secrets or oversized files.", "report": report})
            changed = [f for f in files if f.status != "unchanged"]
            if not changed:
                entry.mode = "noop"
                await log_history(entry)
                return {"mode": "noop", "message": "Everything is already up to date on the remote.", "history": entry.model_dump(), "rate_limit": rate_limit.as_dict()}

            head = report["remote_head"]
            if head is None:
                head = await gh.init_empty_repo(repo, branch)
            base_tree = (await gh.commit(repo, head))["tree"]["sha"]
            shas = await asyncio.gather(*(gh.create_blob(repo, f.data) for f in changed))
            tree = await gh.create_tree(repo, base_tree, [{"path": f.path, "mode": "100644", "type": "blob", "sha": sha} for f, sha in zip(changed, shas)])
            commit_sha = await gh.create_commit(repo, message, tree, [head])
            repo_url = f"https://github.com/{repo}"
            entry.commit_sha, entry.commit_url = commit_sha, f"{repo_url}/commit/{commit_sha}"

            mode = report["predicted_mode"]
            if mode == "direct" and not await gh.update_ref(repo, branch, commit_sha):
                mode, report["reason"] = "pr", "Remote changed mid-push — fell back to branch + PR."
            if mode == "direct":
                entry.mode, entry.branch = "direct", branch
                await save_settings({"baselines": {**s.get("baselines", {}), _bkey(repo, branch): commit_sha}})
            else:
                sync_branch = f"sync/{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
                await gh.create_ref(repo, sync_branch, commit_sha)
                body = f"Automated backup by GitHub Sync.\n\n**Reason:** {report['reason']}\n\n**Files ({len(changed)}):**\n" + "\n".join(f"- `{f.path}` ({f.status})" for f in changed)
                pr = await gh.create_pr(repo, message, sync_branch, branch, body)
                entry.mode, entry.branch, entry.pr_url, entry.pr_number = "pr", sync_branch, pr["html_url"], pr["number"]
            await log_history(entry)
            logger.info("Pushed %d files to %s (%s)", len(changed), repo, entry.mode)
            return {"mode": entry.mode, "reason": report["reason"], "history": entry.model_dump(), "rate_limit": rate_limit.as_dict()}
    except HTTPException as e:
        if entry.mode == "failed":
            d = e.detail if isinstance(e.detail, dict) else {"message": str(e.detail)}
            entry.error = d.get("message", "error")
            entry.files = entry.files or hfiles()
            await log_history(entry)
        raise


@api.get("/history")
async def history():
    docs = await db.push_history.find().sort("created_at", -1).to_list(200)
    return [PushHistory.from_mongo(d).model_dump() for d in docs]


@api.delete("/history")
async def clear_history():
    await db.push_history.delete_many({})
    return []


app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","), allow_methods=["*"], allow_headers=["*"])


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
