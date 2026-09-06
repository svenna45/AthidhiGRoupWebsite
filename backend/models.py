from datetime import datetime, timezone
from typing import Annotated, Any, List, Optional

from bson import ObjectId
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field


def _oid_to_str(v: Any) -> str:
    return str(v) if isinstance(v, ObjectId) else v


PyObjectId = Annotated[str, BeforeValidator(_oid_to_str)]


class BaseDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    id: Optional[PyObjectId] = Field(default=None, alias="_id")

    def to_mongo(self) -> dict:
        data = self.model_dump(by_alias=True, exclude_none=True)
        data.pop("_id", None)
        return data

    @classmethod
    def from_mongo(cls, doc: dict):
        return cls.model_validate(doc)


class HistoryFile(BaseModel):
    path: str
    status: str
    source: str
    size: int


class PushHistory(BaseDocument):
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    repo: str
    base_branch: str
    mode: str  # direct | pr | rejected | failed | noop
    message: str = ""
    commit_sha: Optional[str] = None
    commit_url: Optional[str] = None
    branch: Optional[str] = None
    pr_url: Optional[str] = None
    pr_number: Optional[int] = None
    file_count: int = 0
    files: List[HistoryFile] = []
    error: Optional[str] = None


class TokenIn(BaseModel):
    token: str = Field(min_length=20, max_length=400)


class ConfigIn(BaseModel):
    repo: str = Field(pattern=r"^[\w.-]+/[\w.-]+$")
    branch: str = Field(min_length=1, max_length=200)


class Selection(BaseModel):
    workspace_paths: List[str] = []
    upload_names: List[str] = []
    collections: List[str] = []
    cms_ids: List[str] = []
    message: str = ""


class CmsContent(BaseDocument):
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    title: str
    slug: str
    type: str = "doc"  # doc | page | post
    status: str = "draft"  # draft | published
    body: str = ""


class CmsContentIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    slug: Optional[str] = Field(default=None, max_length=200)
    type: str = Field(default="doc", pattern=r"^(doc|page|post)$")
    status: str = Field(default="draft", pattern=r"^(draft|published)$")
    body: str = ""
