"""Body Language module configuration loader.

Loads ``config.yaml`` and ``suggestions.yaml`` from the Body Language module
folder and exposes validated objects to the rest of the backend.

Behaviour
---------
* ``load_config`` overlays user-provided values onto built-in defaults so the
  system continues to start when individual analyzer threshold fields are
  missing. Each missing field produces a warning string in the returned list
  (Req 12.4).
* If ``config.yaml`` is absent or cannot be parsed, ``load_config`` raises
  :class:`backend.config.ConfigError` (Req 12.5).
* ``load_suggestions`` hard-fails with :class:`SuggestionBankError` when the
  suggestions bank is missing any of the five required metrics or any of the
  four band entries (``low``/``mid``/``high``/``recheck``) for a metric, as
  required by Req 12.6 in support of Req 9.

The ``BUILTIN_DEFAULTS`` constant mirrors the values shipped in
``config.yaml`` so the loader can produce a complete :class:`BodyLanguageConfig`
even when the on-disk file omits whole sections.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from backend.config import ConfigError

# Names of the five metrics produced by the Body Language module. These are
# the metrics for which the suggestions bank MUST provide entries (Req 9, 12.6).
REQUIRED_METRICS: tuple[str, ...] = (
    "posture",
    "eye_contact",
    "gesture",
    "stillness",
    "facial_expression",
)

# Required band / recheck keys per metric in the suggestions bank.
REQUIRED_BANDS: tuple[str, ...] = ("low", "mid", "high", "recheck")

# Built-in defaults for every analyzer threshold and scoring weight. These
# values mirror ``config.yaml`` and act as the fallback that ``load_config``
# overlays user values on top of. Keeping them in code means the loader can
# always return a complete config, even if the YAML file omits whole sections.
BUILTIN_DEFAULTS: dict[str, dict[str, float | int]] = {
    "sampling": {"fps": 5},
    "posture": {
        "neck_to_shoulder_max_deg": 15,
        "shoulder_to_hip_max_deg": 10,
    },
    "eye_contact": {
        "yaw_max_deg": 15,
        "pitch_max_deg": 15,
    },
    "gesture": {
        "hand_to_face_pct_diag": 0.10,
    },
    "stillness": {
        "variance_min": 0.0005,
        "variance_max": 0.01,
    },
    "facial_expression": {
        "smile_ratio_threshold": 0.45,
        "smile_cap_pct": 80,
    },
    "weights": {
        "posture": 0.20,
        "eye_contact": 0.25,
        "gesture": 0.20,
        "stillness": 0.15,
        "facial_expression": 0.20,
    },
}


class SuggestionBankError(RuntimeError):
    """Raised when the suggestions bank is missing required metric entries."""


class _StrictModel(BaseModel):
    """Base Pydantic model with strict field validation."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class SamplingConfig(_StrictModel):
    fps: int = Field(ge=1, le=60)


class PostureConfig(_StrictModel):
    neck_to_shoulder_max_deg: float = Field(gt=0)
    shoulder_to_hip_max_deg: float = Field(gt=0)


class EyeContactConfig(_StrictModel):
    yaw_max_deg: float = Field(gt=0)
    pitch_max_deg: float = Field(gt=0)


class GestureConfig(_StrictModel):
    hand_to_face_pct_diag: float = Field(gt=0, le=1)


class StillnessConfig(_StrictModel):
    variance_min: float = Field(gt=0)
    variance_max: float = Field(gt=0)


class FacialExpressionConfig(_StrictModel):
    smile_ratio_threshold: float = Field(gt=0)
    smile_cap_pct: float = Field(gt=0, le=100)


class WeightsConfig(_StrictModel):
    posture: float = Field(ge=0, le=1)
    eye_contact: float = Field(ge=0, le=1)
    gesture: float = Field(ge=0, le=1)
    stillness: float = Field(ge=0, le=1)
    facial_expression: float = Field(ge=0, le=1)


class BodyLanguageConfig(_StrictModel):
    """Validated Body Language module configuration."""

    sampling: SamplingConfig
    posture: PostureConfig
    eye_contact: EyeContactConfig
    gesture: GestureConfig
    stillness: StillnessConfig
    facial_expression: FacialExpressionConfig
    weights: WeightsConfig


def _read_yaml_mapping(path: Path) -> dict[str, Any]:
    """Read a YAML file and return its top-level mapping.

    Raises ``ConfigError`` when the file is absent, unreadable, not valid
    YAML, or does not contain a mapping at the top level. This is the
    fail-fast path required by Req 12.5.
    """
    if not path.exists():
        raise ConfigError(f"Body Language config file not found: {path}")

    try:
        with path.open("r", encoding="utf-8") as fh:
            raw = yaml.safe_load(fh)
    except (yaml.YAMLError, OSError) as exc:
        raise ConfigError(
            f"Failed to parse Body Language config at {path}: {exc}"
        ) from exc

    if raw is None:
        return {}

    if not isinstance(raw, dict):
        raise ConfigError(
            f"Body Language config at {path} must be a YAML mapping, "
            f"got {type(raw).__name__}"
        )

    return raw


def _overlay_defaults(
    user_values: dict[str, Any],
) -> tuple[dict[str, Any], list[str]]:
    """Overlay user-provided values on top of ``BUILTIN_DEFAULTS``.

    Returns the merged mapping and a list of warning strings naming every
    threshold field that was missing from the user file and substituted with
    a built-in default (Req 12.4).
    """
    merged: dict[str, Any] = {}
    warnings: list[str] = []

    for section_name, default_section in BUILTIN_DEFAULTS.items():
        user_section = user_values.get(section_name)

        if user_section is None:
            # Entire section missing: every field is substituted.
            merged[section_name] = dict(default_section)
            for field_name in default_section:
                warnings.append(
                    f"body_language config: missing '{section_name}."
                    f"{field_name}', using built-in default "
                    f"{default_section[field_name]!r}"
                )
            continue

        if not isinstance(user_section, dict):
            # A wrong-typed section is a hard error, not a missing-field
            # warning: the user wrote something, but it isn't a mapping.
            raise ConfigError(
                f"Body Language config section '{section_name}' must be a "
                f"mapping, got {type(user_section).__name__}"
            )

        section_merged: dict[str, Any] = {}
        for field_name, default_value in default_section.items():
            if field_name in user_section:
                section_merged[field_name] = user_section[field_name]
            else:
                section_merged[field_name] = default_value
                warnings.append(
                    f"body_language config: missing '{section_name}."
                    f"{field_name}', using built-in default {default_value!r}"
                )

        # Preserve any extra keys so Pydantic's ``extra='forbid'`` surfaces
        # typos rather than silently dropping them.
        for extra_key, extra_value in user_section.items():
            if extra_key not in section_merged:
                section_merged[extra_key] = extra_value

        merged[section_name] = section_merged

    # Carry through any top-level sections the user added that aren't in the
    # defaults so Pydantic can reject them with a clear validation error.
    for extra_section, extra_value in user_values.items():
        if extra_section not in merged:
            merged[extra_section] = extra_value

    return merged, warnings


def load_config(folder: Path) -> tuple[BodyLanguageConfig, list[str]]:
    """Load and validate the Body Language module configuration.

    Args:
        folder: Path to the body_language module folder containing
            ``config.yaml``.

    Returns:
        A tuple ``(config, warnings)`` where ``config`` is the validated
        :class:`BodyLanguageConfig` and ``warnings`` is a list of warning
        strings, one per analyzer threshold field that was missing from the
        user file and substituted with a built-in default (Req 12.4).

    Raises:
        ConfigError: If ``config.yaml`` is missing, unparseable, structurally
            invalid, or fails field-level validation (Req 12.5).
    """
    config_path = folder / "config.yaml"
    user_values = _read_yaml_mapping(config_path)
    merged, warnings = _overlay_defaults(user_values)

    try:
        config = BodyLanguageConfig(**merged)
    except ValidationError as exc:
        raise ConfigError(
            f"Invalid Body Language config at {config_path}: {exc}"
        ) from exc

    return config, warnings


def load_suggestions(folder: Path) -> dict[str, dict[str, Any]]:
    """Load and validate the Body Language suggestions bank.

    Args:
        folder: Path to the body_language module folder containing
            ``suggestions.yaml``.

    Returns:
        Mapping from metric name to a dict with keys ``low``, ``mid``,
        ``high`` (each a list of suggestion strings) and ``recheck`` (a single
        re-record message string).

    Raises:
        ConfigError: If ``suggestions.yaml`` is missing or unparseable
            (Req 12.5).
        SuggestionBankError: If the bank is missing any required metric or
            any required band/recheck entry within a metric (Req 12.6).
    """
    suggestions_path = folder / "suggestions.yaml"
    raw = _read_yaml_mapping(suggestions_path)

    missing: list[str] = []
    for metric in REQUIRED_METRICS:
        entry = raw.get(metric)
        if entry is None:
            missing.append(metric)
            continue
        if not isinstance(entry, dict):
            raise SuggestionBankError(
                f"Suggestions bank at {suggestions_path}: metric "
                f"'{metric}' must be a mapping, got {type(entry).__name__}"
            )
        for band in REQUIRED_BANDS:
            if band not in entry or entry[band] in (None, "", []):
                missing.append(f"{metric}.{band}")
                continue
            if band == "recheck":
                if not isinstance(entry[band], str):
                    raise SuggestionBankError(
                        f"Suggestions bank at {suggestions_path}: "
                        f"'{metric}.{band}' must be a string"
                    )
            else:
                if not isinstance(entry[band], list) or not all(
                    isinstance(item, str) for item in entry[band]
                ):
                    raise SuggestionBankError(
                        f"Suggestions bank at {suggestions_path}: "
                        f"'{metric}.{band}' must be a list of strings"
                    )

    if missing:
        raise SuggestionBankError(
            f"Suggestions bank at {suggestions_path} is missing required "
            f"entries: {', '.join(missing)}"
        )

    return {metric: raw[metric] for metric in REQUIRED_METRICS}
