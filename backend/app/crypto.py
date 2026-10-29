"""Field-level encryption (AES-256-GCM) — Rule 6: encryption / obfuscation / masking.

Identifiers (name, contact, DOB, guardian, nominee) and free-text clinical data are stored only as
ciphertext. Erasure is performed by overwriting these fields (crypto-shredding of the record).
"""
import base64
import json
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import settings

_PREFIX = "v1:"


def _aes() -> AESGCM:
    return AESGCM(settings.data_key)


def enc(value) -> str | None:
    if value is None or value == "":
        return None
    raw = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    nonce = os.urandom(12)
    ct = _aes().encrypt(nonce, raw.encode("utf-8"), b"haem5")
    return _PREFIX + base64.b64encode(nonce + ct).decode()


def dec(token: str | None) -> str | None:
    if not token:
        return None
    if not token.startswith(_PREFIX):
        raise ValueError("Unknown ciphertext version")
    blob = base64.b64decode(token[len(_PREFIX):])
    return _aes().decrypt(blob[:12], blob[12:], b"haem5").decode("utf-8")


def dec_json(token: str | None):
    s = dec(token)
    return json.loads(s) if s else None


def mask_name(name: str | None) -> str:
    """Display masking for list views (data minimisation)."""
    if not name:
        return "—"
    parts = name.split()
    return " ".join(p[0] + "•" * max(1, len(p) - 1) for p in parts)


def mask_contact(c: str | None) -> str:
    if not c:
        return "—"
    return "•" * max(0, len(c) - 4) + c[-4:]
