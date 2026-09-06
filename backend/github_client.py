import asyncio
import base64
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import HTTPException

API = "https://api.github.com"


class RateLimit:
    limit: Optional[int] = None
    remaining: Optional[int] = None
    reset: Optional[str] = None

    def update(self, h):
        if "x-ratelimit-limit" in h:
            self.limit = int(h["x-ratelimit-limit"])
            self.remaining = int(h.get("x-ratelimit-remaining", 0))
            self.reset = datetime.fromtimestamp(int(h.get("x-ratelimit-reset", 0)), tz=timezone.utc).isoformat()

    def as_dict(self):
        return {"limit": self.limit, "remaining": self.remaining, "reset": self.reset}


rate_limit = RateLimit()


def gh_error(status: int, code: str, message: str, extra: dict | None = None):
    return HTTPException(status, {"code": code, "message": message, "rate_limit": rate_limit.as_dict(), **(extra or {})})


class GitHub:
    def __init__(self, token: str):
        self._headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        self._client: httpx.AsyncClient | None = None
        self._sem = asyncio.Semaphore(6)

    async def __aenter__(self):
        self._client = httpx.AsyncClient(base_url=API, timeout=60, headers=self._headers)
        return self

    async def __aexit__(self, *_):
        await self._client.aclose()

    async def req(self, method: str, path: str, allow=(), **kw):
        r = None
        for attempt in range(3):
            async with self._sem:
                try:
                    r = await self._client.request(method, path, **kw)
                except httpx.HTTPError as e:
                    raise gh_error(502, "network", f"Could not reach GitHub: {type(e).__name__}")
            rate_limit.update(r.headers)
            if r.status_code in (403, 429) and r.headers.get("x-ratelimit-remaining") == "0":
                raise gh_error(429, "rate_limited", f"GitHub rate limit exhausted. Resets at {rate_limit.reset}.")
            if r.status_code in (403, 429) and "retry-after" in r.headers and attempt < 2:
                await asyncio.sleep(min(int(r.headers["retry-after"]), 15))
                continue
            break
        if r.status_code in allow:
            return None
        if r.status_code == 401:
            raise gh_error(401, "invalid_token", "GitHub rejected the token — it is invalid, expired or revoked.")
        if r.status_code >= 400:
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            msg = body.get("message", r.text[:200]) if isinstance(body, dict) else r.text[:200]
            if r.status_code == 403:
                msg = f"Forbidden: {msg}. Check the PAT has Contents + Pull requests read/write on this repo."
            raise gh_error(r.status_code, "github_error", msg, {"github": body})
        return r.json() if r.content else None

    # --- account / repos ---
    async def user(self):
        return await self.req("GET", "/user")

    async def repos(self):
        out, page = [], 1
        while True:
            rows = await self.req("GET", "/user/repos", params={"per_page": 100, "page": page, "sort": "updated", "affiliation": "owner,collaborator,organization_member"})
            out += [{"full_name": x["full_name"], "default_branch": x.get("default_branch"), "private": x["private"], "html_url": x["html_url"]} for x in rows]
            if len(rows) < 100 or page >= 5:
                return out
            page += 1

    async def repo(self, full: str):
        return await self.req("GET", f"/repos/{full}")

    async def branches(self, full: str):
        rows = await self.req("GET", f"/repos/{full}/branches", params={"per_page": 100}, allow=(409,))
        return [b["name"] for b in rows or []]

    # --- git data ---
    async def ref_sha(self, full: str, branch: str) -> Optional[str]:
        data = await self.req("GET", f"/repos/{full}/git/ref/heads/{branch}", allow=(404, 409))
        return data["object"]["sha"] if data else None

    async def commit(self, full: str, sha: str):
        return await self.req("GET", f"/repos/{full}/git/commits/{sha}")

    async def tree(self, full: str, tree_sha: str) -> dict:
        data = await self.req("GET", f"/repos/{full}/git/trees/{tree_sha}", params={"recursive": "1"})
        return {e["path"]: e["sha"] for e in data.get("tree", []) if e["type"] == "blob"}

    async def blob(self, full: str, sha: str) -> bytes:
        data = await self.req("GET", f"/repos/{full}/git/blobs/{sha}")
        return base64.b64decode(data["content"]) if data.get("encoding") == "base64" else data["content"].encode()

    async def create_blob(self, full: str, content: bytes) -> str:
        data = await self.req("POST", f"/repos/{full}/git/blobs", json={"content": base64.b64encode(content).decode(), "encoding": "base64"})
        return data["sha"]

    async def create_tree(self, full: str, base_tree: str, entries: list) -> str:
        data = await self.req("POST", f"/repos/{full}/git/trees", json={"base_tree": base_tree, "tree": entries})
        return data["sha"]

    async def create_commit(self, full: str, message: str, tree: str, parents: list) -> str:
        data = await self.req("POST", f"/repos/{full}/git/commits", json={"message": message, "tree": tree, "parents": parents})
        return data["sha"]

    async def create_ref(self, full: str, branch: str, sha: str):
        await self.req("POST", f"/repos/{full}/git/refs", json={"ref": f"refs/heads/{branch}", "sha": sha})

    async def update_ref(self, full: str, branch: str, sha: str) -> bool:
        try:
            await self.req("PATCH", f"/repos/{full}/git/refs/heads/{branch}", json={"sha": sha, "force": False})
            return True
        except HTTPException as e:
            if e.status_code in (409, 422):
                return False
            raise

    async def create_pr(self, full: str, title: str, head: str, base: str, body: str):
        return await self.req("POST", f"/repos/{full}/pulls", json={"title": title, "head": head, "base": base, "body": body})

    async def init_empty_repo(self, full: str, branch: str) -> str:
        body = {"message": "chore: initialize repository (github-sync)", "content": base64.b64encode(b"# Repository initialized by GitHub Sync\n").decode(), "branch": branch}
        data = await self.req("PUT", f"/repos/{full}/contents/README.md", json=body)
        return data["commit"]["sha"]
