import re

PATTERNS = [
    ("GitHub token", re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b")),
    ("GitHub fine-grained token", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{40,}\b")),
    ("AWS access key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("OpenAI-style key", re.compile(r"\bsk-(?:proj-|ant-|emergent-)?[A-Za-z0-9_\-]{20,}\b")),
    ("Stripe key", re.compile(r"\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b")),
    ("Slack token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z\-_]{35}\b")),
    ("Private key block", re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----")),
    ("JWT", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")),
    ("Connection string with credentials", re.compile(r"\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp)://[^\s:@/]+:[^\s@/]+@")),
]
ASSIGN = re.compile(r"(?i)\b([A-Z0-9_]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|FERNET_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*[:=]\s*(['\"]?)([^\s'\"]{8,})\2")
PLACEHOLDER = re.compile(r"(?i)example|placeholder|your[_-]|xxx|<|>|changeme|\$\{|process\.env|os\.environ|\*\*\*|dummy|redacted")


SLUG_RE = re.compile(r"^[a-z]+(?:-[a-z]+)+$")


def _looks_secret(value: str, quoted: bool) -> bool:
    if SLUG_RE.match(value):  # kebab-case slugs (test-ids, css classes, i18n keys) are never secrets
        return False
    if quoted:
        return len(value) >= 8
    return len(value) >= 16 and any(c.isdigit() for c in value) and any(c.isalpha() for c in value) and "." not in value


def is_binary(data: bytes) -> bool:
    return b"\x00" in data[:8000]


def scan(path: str, data: bytes) -> list[dict]:
    if is_binary(data) or len(data) > 5_000_000:
        return []
    text = data.decode("utf-8", errors="ignore")
    findings = []
    for i, line in enumerate(text.splitlines(), 1):
        for name, rx in PATTERNS:
            if rx.search(line):
                findings.append({"path": path, "line": i, "kind": name})
                break
        else:
            m = ASSIGN.search(line)
            if m and not PLACEHOLDER.search(line) and _looks_secret(m.group(3), bool(m.group(2))):
                findings.append({"path": path, "line": i, "kind": f"Hardcoded {m.group(1).lower()}"})
    return findings[:20]
