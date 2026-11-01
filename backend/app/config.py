from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    tutor_username: str
    tutor_password: str
    student_username: str
    student_password: str
    tutor_name: str
    secret: str
    data_dir: Path
    trust_proxy: bool
    cookie_secure: bool


_settings: Settings | None = None


def reset_settings() -> None:
    global _settings
    _settings = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = load_settings()
    return _settings


def load_settings() -> Settings:
    tutor_username = os.environ.get("TUTOR_USERNAME", "").strip()
    tutor_password = os.environ.get("TUTOR_PASSWORD", "")
    student_username = os.environ.get("STUDENT_USERNAME", "").strip()
    student_password = os.environ.get("STUDENT_PASSWORD", "")
    tutor_name = os.environ.get("TUTOR_NAME", "Репетитор").strip() or "Репетитор"
    secret = os.environ.get("SECRET_KEY", "").strip()
    data_dir = Path(os.environ.get("DATA_DIR", "./data")).resolve()
    trust_proxy = os.environ.get("TRUST_PROXY", "0").strip() in {"1", "true", "yes"}
    cookie_secure = os.environ.get("COOKIE_SECURE", "0").strip() in {"1", "true", "yes"}

    if not tutor_username or not student_username:
        raise RuntimeError("Задайте TUTOR_USERNAME и STUDENT_USERNAME в .env")
    if tutor_username == student_username:
        raise RuntimeError("Логин репетитора и логин учеников должны отличаться")
    if len(tutor_password) < 6 or len(student_password) < 6:
        raise RuntimeError("Пароли в .env должны быть не короче 6 символов")
    if len(secret) < 24 or "replace" in secret.lower() or secret.lower().startswith("change"):
        raise RuntimeError("Задайте длинный случайный SECRET_KEY в .env")
    if len(tutor_name) > 40:
        tutor_name = tutor_name[:40]

    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "uploads").mkdir(parents=True, exist_ok=True)

    return Settings(
        tutor_username=tutor_username,
        tutor_password=tutor_password,
        student_username=student_username,
        student_password=student_password,
        tutor_name=tutor_name,
        secret=secret,
        data_dir=data_dir,
        trust_proxy=trust_proxy,
        cookie_secure=cookie_secure,
    )
