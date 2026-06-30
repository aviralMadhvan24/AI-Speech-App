"""Module Registry: discovers Analysis_Modules from manifest.json files.

Walks ``backend/modules/*/manifest.json`` at startup, validates each manifest,
imports the entry callable via :mod:`importlib`, and registers the module.
Malformed manifests or import failures are logged and the module is skipped
(Req 11.6). :class:`BodyLanguageMissingError` lets the caller turn a missing
``body_language`` registration into a ``no_modules_available`` response at
the route layer (Req 11.7), while :class:`UnknownModuleError` covers unknown
module ids in session requests (Req 11.8).
"""

from __future__ import annotations

import importlib
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

# The id the spec marks as critical: if this module is missing, the backend
# refuses to create sessions (Req 11.7).
BODY_LANGUAGE_MODULE_ID = "body_language"

# Required manifest fields and their expected python types.
_REQUIRED_FIELDS: dict[str, type] = {
    "id": str,
    "display_name": str,
    "version": str,
    "entry": str,
    "config_files": list,
}


class ModuleRegistryError(Exception):
    """Base class for module registry errors."""


class UnknownModuleError(ModuleRegistryError):
    """Raised by :meth:`ModuleRegistry.get_module` for an unregistered id (Req 11.8)."""

    def __init__(self, module_id: str) -> None:
        self.module_id = module_id
        super().__init__(f"Unknown analysis module: {module_id!r}")


class BodyLanguageMissingError(ModuleRegistryError):
    """Raised when the ``body_language`` module failed to register (Req 11.7).

    The HTTP layer maps this to a 503 ``no_modules_available`` response.
    """

    def __init__(self) -> None:
        super().__init__(
            "body_language module is not registered; "
            "no analysis modules are available"
        )


@dataclass(frozen=True)
class RegisteredModule:
    """A successfully discovered Analysis_Module."""

    id: str
    display_name: str
    version: str
    entry_callable: Optional[Callable[..., Any]]
    config_files: tuple[str, ...]
    folder_path: Path


@dataclass
class ModuleRegistry:
    """Discovers and stores Analysis_Modules from a modules directory."""

    _modules: dict[str, RegisteredModule] = field(default_factory=dict)
    errors: list[dict[str, str]] = field(default_factory=list)

    # ------------------------------------------------------------------ #
    # discovery
    # ------------------------------------------------------------------ #

    def discover(self, modules_dir: Path) -> None:
        """Walk ``modules_dir/<id>/manifest.json`` and register each module.

        Bad manifests or import failures are logged and skipped (Req 11.6).
        Re-calling :meth:`discover` clears prior state so the registry can be
        rebuilt during tests or on reload.
        """
        self._modules.clear()
        self.errors.clear()

        if not modules_dir.is_dir():
            logger.error("Modules directory does not exist: %s", modules_dir)
            self._record_error(modules_dir, "modules_dir_missing")
            return

        for child in sorted(modules_dir.iterdir()):
            if not child.is_dir():
                continue
            manifest_path = child / "manifest.json"
            if not manifest_path.is_file():
                # Folders without manifests (e.g., __pycache__) are just skipped.
                continue
            self._register_one(child, manifest_path)

    def _register_one(self, folder: Path, manifest_path: Path) -> None:
        # 1. Read + parse the manifest.
        try:
            raw = manifest_path.read_text(encoding="utf-8")
            manifest = json.loads(raw)
        except (OSError, json.JSONDecodeError) as exc:
            logger.error("Failed to read manifest %s: %s", manifest_path, exc)
            self._record_error(folder, "manifest_unreadable", str(exc))
            return

        if not isinstance(manifest, dict):
            logger.error("Manifest %s must be a JSON object", manifest_path)
            self._record_error(folder, "manifest_not_object")
            return

        # 2. Validate required fields and types.
        for field_name, field_type in _REQUIRED_FIELDS.items():
            if field_name not in manifest:
                logger.error(
                    "Manifest %s is missing required field %r",
                    manifest_path,
                    field_name,
                )
                self._record_error(folder, "manifest_field_missing", field_name)
                return
            if not isinstance(manifest[field_name], field_type):
                logger.error(
                    "Manifest %s field %r has wrong type (expected %s)",
                    manifest_path,
                    field_name,
                    field_type.__name__,
                )
                self._record_error(folder, "manifest_field_wrong_type", field_name)
                return

        module_id: str = manifest["id"]
        entry: str = manifest["entry"]

        # 3. Parse the "<module.path>:<callable>" entry spec.
        entry_module, sep, entry_attr = entry.partition(":")
        if not sep or not entry_module or not entry_attr:
            logger.error("Manifest %s entry %r is malformed", manifest_path, entry)
            self._record_error(folder, "entry_malformed", entry)
            return

        # 4. Import the entry module.
        try:
            imported = importlib.import_module(entry_module)
        except ImportError as exc:
            logger.error(
                "Failed to import entry module %r for %s: %s",
                entry_module,
                module_id,
                exc,
            )
            self._record_error(
                folder, "entry_import_failed", f"{entry_module}: {exc}"
            )
            return

        # 5. Resolve the callable. The ``run`` function may not exist yet
        #    (task 11.1). Register the module without a callable in that case
        #    so it still shows up in list_modules.
        entry_callable: Optional[Callable[..., Any]]
        try:
            entry_callable = getattr(imported, entry_attr)
        except AttributeError:
            logger.warning(
                "Entry callable %r not yet defined on %s; module %s registered "
                "without an executable entry point",
                entry_attr,
                entry_module,
                module_id,
            )
            entry_callable = None

        if entry_callable is not None and not callable(entry_callable):
            logger.error(
                "Entry %r on %s is not callable for module %s",
                entry_attr,
                entry_module,
                module_id,
            )
            self._record_error(folder, "entry_not_callable", entry)
            return

        # 6. Guard against duplicate ids.
        if module_id in self._modules:
            logger.error(
                "Duplicate module id %r in %s; keeping the first registration",
                module_id,
                folder,
            )
            self._record_error(folder, "duplicate_module_id", module_id)
            return

        self._modules[module_id] = RegisteredModule(
            id=module_id,
            display_name=manifest["display_name"],
            version=manifest["version"],
            entry_callable=entry_callable,
            config_files=tuple(manifest["config_files"]),
            folder_path=folder,
        )
        logger.info(
            "Registered analysis module %s v%s",
            module_id,
            manifest["version"],
        )

    def _record_error(self, folder: Path, reason: str, detail: str = "") -> None:
        self.errors.append(
            {"folder": str(folder), "reason": reason, "detail": detail}
        )

    # ------------------------------------------------------------------ #
    # accessors
    # ------------------------------------------------------------------ #

    def list_modules(self) -> list[dict[str, str]]:
        """Return registered modules as id/display_name/version dicts (Req 11.4)."""
        return [
            {"id": m.id, "display_name": m.display_name, "version": m.version}
            for m in self._modules.values()
        ]

    def get_module(self, module_id: str) -> RegisteredModule:
        """Return the :class:`RegisteredModule` with ``module_id``.

        Raises :class:`UnknownModuleError` if the id is not registered (Req 11.8).
        """
        try:
            return self._modules[module_id]
        except KeyError as exc:
            raise UnknownModuleError(module_id) from exc

    def has_body_language(self) -> bool:
        """Return True iff the ``body_language`` module is registered."""
        return BODY_LANGUAGE_MODULE_ID in self._modules

    def require_body_language(self) -> RegisteredModule:
        """Return the ``body_language`` module or raise :class:`BodyLanguageMissingError`.

        Used by the session-creation route to enforce Req 11.7.
        """
        try:
            return self._modules[BODY_LANGUAGE_MODULE_ID]
        except KeyError as exc:
            raise BodyLanguageMissingError() from exc

    def __contains__(self, module_id: object) -> bool:
        return isinstance(module_id, str) and module_id in self._modules

    def __len__(self) -> int:
        return len(self._modules)
