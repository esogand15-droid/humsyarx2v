# -*- coding: utf-8 -*-
"""Student User Code Engine for HumsYarX Web Authentication.

Generates and normalizes 8-character Crockford-Base32 codes (XXXX-XXXX).
Alphabet excludes ambiguous characters (0, O, 1, I, L) to ensure
effortless user entry on mobile, tablet, and desktop devices.
"""
from __future__ import annotations

import re
import secrets
from typing import Optional
import logging

logger = logging.getLogger(__name__)

# Crockford Base32 charset without ambiguous characters
# 32 characters: 0123456789ABCDEFGHJKMNPQRSTVWXYZ (excludes I, L, O, U)
CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
CODE_LENGTH = 8
CODE_REGEX = re.compile(
    r"^(?:HY-?)?[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-?[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$",
    re.IGNORECASE,
)


def generate_raw_code(length: int = CODE_LENGTH) -> str:
    """Generate cryptographically secure Crockford Base32 string."""
    return "".join(secrets.choice(CROCKFORD_ALPHABET) for _ in range(length))


def format_code(raw: str, prefix: bool = True) -> str:
    """Format raw 8-character code as HY-XXXX-XXXX (or XXXX-XXXX if prefix=False)."""
    clean = normalize_code(raw)
    if len(clean) == 8:
        base = f"{clean[:4]}-{clean[4:]}"
        return f"HY-{base}" if prefix else base
    return clean


def normalize_code(code: Optional[str]) -> str:
    """Normalize input code: uppercase, strip whitespace, remove HY- prefix and dashes.

    Maps common accidental typos:
    - O -> 0
    - I, L -> 1
    """
    if not code:
        return ""
    clean = code.strip().upper().replace(" ", "")
    if clean.startswith("HY-"):
        clean = clean[3:]
    elif clean.startswith("HY") and len(clean.replace("-", "")) > CODE_LENGTH:
        clean = clean[2:]
    clean = clean.replace("-", "")
    # Map common accidental typos (O -> 0, I/L -> 1)
    clean = clean.replace("O", "0").replace("I", "1").replace("L", "1")
    return clean


def is_valid_code_format(code: Optional[str]) -> bool:
    """Check if code matches 8-character Crockford pattern (with or without hyphen, optional HY- prefix)."""
    if not code:
        return False
    s = code.strip()
    if CODE_REGEX.match(s):
        return True
    norm = normalize_code(s)
    return len(norm) == 8 and all(c in CROCKFORD_ALPHABET for c in norm)


async def get_or_create_user_code(db_client, user_id: int) -> str:
    """Ensure student has a unique 8-character code in MongoDB users collection."""
    user = await db_client.users.find_one({"user_id": user_id})
    if not user:
        raise ValueError(f"User {user_id} not found in database")

    existing_code = user.get("web_login_code")
    if existing_code and is_valid_code_format(existing_code):
        return format_code(existing_code)

    # Generate unique code with collision retry loop
    for _ in range(10):
        candidate_raw = generate_raw_code()
        candidate_formatted_hy = format_code(candidate_raw, prefix=True)
        candidate_formatted_dash = format_code(candidate_raw, prefix=False)

        # Check uniqueness against MongoDB
        collision = await db_client.users.find_one({
            "$or": [
                {"web_login_code": candidate_formatted_hy},
                {"web_login_code": candidate_formatted_dash},
                {"web_login_code": candidate_raw},
            ]
        })
        if not collision:
            await db_client.users.update_one(
                {"user_id": user_id},
                {"$set": {"web_login_code": candidate_formatted_hy}}
            )
            logger.info("Generated new student code for user %s: %s", user_id, candidate_formatted_hy)
            return candidate_formatted_hy

    raise RuntimeError("Failed to generate unique student code after 10 attempts")


async def find_user_by_code(db_client, code: str) -> Optional[dict]:
    """Find user document by normalized 8-character student code."""
    if not is_valid_code_format(code):
        return None
    raw = normalize_code(code)
    formatted_hy = format_code(raw, prefix=True)
    formatted_dash = format_code(raw, prefix=False)

    return await db_client.users.find_one({
        "$or": [
            {"web_login_code": formatted_hy},
            {"web_login_code": formatted_dash},
            {"web_login_code": raw},
        ]
    })
