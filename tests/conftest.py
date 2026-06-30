"""Session-wide test fixtures.

We force `AUTH_BYPASS=true` before any `app.*` module imports so that
endpoints with `Depends(require_user)` don't fail in unit tests. The current
test suite is unit-level and doesn't hit FastAPI directly, but new tests can
rely on this bypass without extra setup.
"""

from __future__ import annotations

import os


# Set the env var as early as possible — pytest imports conftest before any
# test module, and most app imports happen inside the test modules.
os.environ.setdefault("AUTH_BYPASS", "true")
