"""Body Language analysis module.

Phase 1 ``Analysis_Module`` that bundles the five body-language analyzers
(posture, eye contact, gesture, stillness, facial expression) behind the
common ``run(video_path, config) -> ModuleResult`` contract documented in
design.md → "Analysis_Module Interface" / "Body_Language_Module.run".

The entry point:

1. Loads the module's own ``config.yaml`` via :mod:`config_loader` and
   converts the validated :class:`BodyLanguageConfig` into a plain ``dict``
   so the analyzers (which take ``cfg: dict``) can index into it.
2. Calls :func:`frame_sampler.sample` **once** so the video is decoded
   and MediaPipe Pose/Face Mesh/Hands run a single pass. The resulting
   ``list[FrameLandmarks]`` is reused by every analyzer (Req 11.9).
3. Invokes each of the five analyzers in turn. Any exception escaping an
   analyzer (e.g. a MediaPipe runtime failure) is logged at ERROR and
   converted to ``MetricResult(score=None, flag="detection_failed")`` so
   the rest of the pipeline can still finish — this is the fail-soft
   contract from design.md ("If MediaPipe itself raises ... the analyzer
   wraps the exception and returns score=None, flag='detection_failed'").
4. Returns a :class:`ModuleResult` carrying all five metrics, in the
   fixed order ``posture, eye_contact, gesture, stillness,
   facial_expression``.

``UnsupportedFormatError`` from the frame sampler is intentionally **not**
caught here: it indicates the recording itself is undecodable and the
session pipeline maps it to state ``failed`` / ``unsupported_format``
(Req 2.6).

The ``config`` parameter on ``run`` is accepted for the
``Analysis_Module`` interface but currently unused — module config is
loaded from disk. The registry can be extended later to pass overrides.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

from backend.schemas import FrameLandmarks, MetricResult, ModuleResult

from . import config_loader, frame_sampler
from .analyzers import (
    eye_contact,
    facial_expression,
    gesture,
    posture,
    stillness,
)

logger = logging.getLogger(__name__)

# Module folder used by the config loader. Resolving this once at import
# time avoids a ``Path(__file__).parent`` round-trip on every ``run`` call.
_MODULE_FOLDER: Path = Path(__file__).parent

# Ordered (name, analyzer) pairs. The name is used both as the metric name
# on the fallback ``MetricResult`` and in the error log so an operator can
# tell *which* analyzer raised. Order matches design.md and Req 11.9.
_AnalyzeFn = Callable[[list[FrameLandmarks], dict], MetricResult]
_ANALYZERS: tuple[tuple[str, _AnalyzeFn], ...] = (
    ("posture", posture.analyze),
    ("eye_contact", eye_contact.analyze),
    ("gesture", gesture.analyze),
    ("stillness", stillness.analyze),
    ("facial_expression", facial_expression.analyze),
)


def run(video_path: str, config: dict | None = None) -> ModuleResult:
    """Run the Body Language module against ``video_path``.

    Parameters
    ----------
    video_path:
        Filesystem path to the recorded webcam video. Forwarded to
        :func:`frame_sampler.sample`.
    config:
        Reserved for future per-call overrides from the Module_Registry.
        Currently ignored — the module loads its own ``config.yaml`` from
        disk so analyzers see validated, defaulted thresholds.

    Returns
    -------
    ModuleResult
        ``module_id="body_language"`` with five ``MetricResult`` entries
        (posture, eye_contact, gesture, stillness, facial_expression).

    Raises
    ------
    backend.config.ConfigError
        Propagated from the config loader when ``config.yaml`` is missing
        or invalid (Req 12.5).
    frame_sampler.UnsupportedFormatError
        Propagated when OpenCV cannot decode ``video_path``. The session
        pipeline maps this to state ``failed`` / ``unsupported_format``
        (Req 2.6).
    """
    del config  # currently unused; see module docstring

    # 1. Load module config and flatten to a plain dict for analyzers.
    bl_config, warnings = config_loader.load_config(_MODULE_FOLDER)
    for warning in warnings:
        logger.warning("%s", warning)
    cfg: dict = bl_config.model_dump()

    # 2. Single-pass video decode + MediaPipe inference (Req 11.9).
    frames = frame_sampler.sample(video_path, cfg)

    # 3. Run each analyzer; wrap any per-analyzer exception as a
    #    ``detection_failed`` metric so the rest of the pipeline can
    #    finish (design.md fail-soft contract).
    metrics: list[MetricResult] = []
    for metric_name, analyze in _ANALYZERS:
        try:
            metrics.append(analyze(frames, cfg))
        except Exception:  # noqa: BLE001 — fail-soft per design.md
            logger.exception(
                "body_language analyzer %r raised; emitting detection_failed",
                metric_name,
            )
            metrics.append(
                MetricResult(
                    name=metric_name,
                    score=None,
                    flag="detection_failed",
                )
            )

    return ModuleResult(module_id="body_language", metrics=metrics)


__all__ = ["run"]
