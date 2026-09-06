import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://github-vault-5.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    yield s


@pytest.fixture(scope="class")
def cms_cleanup(session):
    yield
    try:
        r = session.get(f"{API}/cms", timeout=15)
        if r.status_code == 200:
            for it in r.json():
                if it.get("title", "").startswith("TEST_"):
                    session.delete(f"{API}/cms/{it['id']}", timeout=15)
    except Exception:
        pass


# Shared state across the ordered CRUD test flow
STATE = {}


class TestCmsCrud:
    @pytest.fixture(autouse=True, scope="class")
    def _cleanup(self, cms_cleanup):
        yield

    def test_01_create_cms(self, session):
        r = session.post(f"{API}/cms", json={
            "title": "TEST_Welcome Page", "type": "page", "status": "draft",
            "body": "# Hello\nBody here"
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["id"] and isinstance(d["id"], str)
        assert d["title"] == "TEST_Welcome Page"
        assert d["slug"] == "test-welcome-page"
        assert d["type"] == "page" and d["status"] == "draft"
        assert d["created_at"] and d["updated_at"]
        STATE["id1"] = d["id"]
        time.sleep(0.3)
        STATE["slug1"] = d["slug"]

    def test_02_slug_uniqueness(self, session):
        r = session.post(f"{API}/cms", json={
            "title": "TEST_Welcome Page", "type": "page", "status": "draft", "body": "dup"
        })
        assert r.status_code == 200
        slug2 = r.json()["slug"]
        assert slug2 != STATE["slug1"], f"expected unique slug, got {slug2}"
        assert slug2.startswith(STATE["slug1"])
        STATE["id_dup"] = r.json()["id"]
        time.sleep(0.3)

    def test_03_list_newest_first(self, session):
        r2 = session.post(f"{API}/cms", json={
            "title": "TEST_Second Item", "type": "post", "status": "published", "body": "b"
        })
        assert r2.status_code == 200
        STATE["id2"] = r2.json()["id"]
        time.sleep(0.3)
        r = session.get(f"{API}/cms")
        assert r.status_code == 200
        items = r.json()
        ids = [i["id"] for i in items]
        assert STATE["id1"] in ids, f"id1 missing from list; got {ids[:5]}"
        assert STATE["id2"] in ids
        assert ids.index(STATE["id2"]) < ids.index(STATE["id1"])

    def test_04_update_cms(self, session):
        # sanity: id1 should exist
        pre = session.get(f"{API}/cms").json()
        pre_ids = [x["id"] for x in pre]
        assert STATE["id1"] in pre_ids, f"id1 {STATE['id1']} missing before update. Have {pre_ids[:10]}"
        r = session.put(f"{API}/cms/{STATE['id1']}", json={
            "title": "TEST_Welcome Page Updated", "type": "page", "status": "published",
            "body": "changed"
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["title"] == "TEST_Welcome Page Updated"
        assert d["status"] == "published"
        assert d["body"] == "changed"
        g = session.get(f"{API}/cms").json()
        found = next(x for x in g if x["id"] == STATE["id1"])
        assert found["title"] == "TEST_Welcome Page Updated"
        assert found["updated_at"] >= found["created_at"]

    def test_05_delete_cms(self, session):
        r = session.delete(f"{API}/cms/{STATE['id2']}")
        assert r.status_code == 200
        g = session.get(f"{API}/cms").json()
        assert not any(x["id"] == STATE["id2"] for x in g)

    def test_06_update_invalid_id_404(self, session):
        r = session.put(f"{API}/cms/notavalidobjectid", json={
            "title": "x", "type": "page", "status": "draft", "body": ""
        })
        assert r.status_code == 404


class TestSourcesCollections:
    def test_collections_hides_cms_content(self, session):
        r = session.get(f"{API}/sources/collections")
        assert r.status_code == 200
        cols = r.json()
        names = [c.get("name") if isinstance(c, dict) else c for c in cols]
        assert "cms_content" not in names
        assert "gh_settings" not in names
