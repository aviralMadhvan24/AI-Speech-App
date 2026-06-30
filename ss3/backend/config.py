"""Global backend configuration loader.

Reads ``backend/config.yaml`` into a validated :class:`BackendConfig`. The file
is optional: if it is missing, built-in defaults are used. If the file is
present but cannot be parsed as YAML (or fails validation), startup fails fast
with a :class:`ConfigError` so misconfiguration is surfaced loudly rather than
silently masked by defaults.

Fields
------
host : str
    Loopback interface the backend binds to (Req 13.1).
port : int
    TCP port in [1024, 65535] (Req 13.1).
data_dir : str
    Local directory for session videos, reports, and metadata (Req 13.3).
retention_limit : int
    Maximum number of stored sessions before retention pruning kicks in.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field, ValidationError, field_validator


# Default location of the global backend config file, resolved relative to this
# module so it works regardless of the process working directory.
DEFAULT_CONFIG_PATH: Path = Path(__file__).resolve().parent / "config.yaml"


class ConfigError(RuntimeError):
    """Raised when ``config.yaml`` is present but unparseable or invalid."""


class BackendConfig(BaseModel):
    """Validated global backend configuration."""

    host: str = "127.0.0.1"
    port: int = Field(default=8000, ge=1024, le=65535)
    data_dir: str = "./data"
    retention_limit: int = Field(default=20, ge=1)

    @field_validator("host")
    @classmethod
    def _host_nonempty(cls, v: str) -> str:
        if not isinstance(v, str) or not v.strip():
            raise ValueError("host must be a non-empty string")
        return v

    @field_validator("data_dir")
    @classmethod
    def _data_dir_nonempty(cls, v: str) -> str:
        if not isinstance(v, str) or not v.strip():
            raise ValueError("data_dir must be a non-empty path string")
        return v


def load_config(path: Path | str | None = None) -> BackendConfig:
    """Load the global backend config.

    Behavior:
        * If the file does not exist, return :class:`BackendConfig` with
          built-in defaults.
        * If the file exists but cannot be parsed as YAML, raise
          :class:`ConfigError` (fail fast).
        * If parsed values fail validation (e.g., port out of range),
          raise :class:`ConfigError`.

    Args:
        path: Optional override for the config file path. Defaults to
            ``backend/config.yaml`` next to this module.

    Returns:
        Validated :class:`BackendConfig` instance.
    """
    config_path = Path(path) if path is not None else DEFAULT_CONFIG_PATH

    if not config_path.exists():
        return BackendConfig()

    try:
        with config_path.open("r", encoding="utf-8") as fh:
            raw: Any = yaml.safe_load(fh)
    except (yaml.YAMLError, OSError) as exc:
        raise ConfigError(
            f"Failed to parse backend config at {config_path}: {exc}"
        ) from exc

    if raw is None:
        # Empty file: treat as all-defaults rather than an error.
        raw = {}

    if not isinstance(raw, dict):
        raise ConfigError(
            f"Backend config at {config_path} must be a YAML mapping, "
            f"got {type(raw).__name__}"
        )

    try:
        return BackendConfig(**raw)
    except ValidationError as exc:
        raise ConfigError(
            f"Invalid backend config at {config_path}: {exc}"
        ) from exc
