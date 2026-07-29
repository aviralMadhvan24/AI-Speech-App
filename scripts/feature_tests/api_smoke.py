"""HTTP smoke test over the real router set.

Builds a bare FastAPI app around ``app.api.routes.router`` rather than
importing ``app.main``, which avoids the startup hook that preloads Whisper
and the static-file mount at "/".

Auth note: ``AUTH_BYPASS`` collapses every request onto a single fixed dev
user, so multi-user flows cannot be driven over HTTP. That is why the debate
and GD runs talk to the room managers directly.
"""

from __future__ import annotations

from app.core.config import settings

from .harness import Report


def _client():
    import warnings

    from fastapi import FastAPI

    with warnings.catch_warnings():
        # starlette warns about httpx here; irrelevant to what we're testing.
        warnings.simplefilter("ignore")
        from fastapi.testclient import TestClient

    from app.api.routes import router

    api = FastAPI(title="feature-test")
    api.include_router(router)
    # No context manager: skips lifespan/startup so Whisper is never loaded.
    return TestClient(api)


def run(report: Report) -> None:
    section = report.section("API SMOKE - routes reachable and role-gated")

    original_bypass = settings.AUTH_BYPASS
    original_teachers = settings.TEACHER_EMAILS

    try:
        client = _client()
    except Exception as exc:  # noqa: BLE001
        section.error = f"could not build test client: {type(exc).__name__}: {exc}"
        return

    try:
        settings.AUTH_BYPASS = True
        settings.TEACHER_EMAILS = "someone.else@kiet.edu"  # dev user = student

        response = client.get("/openapi.json")
        section.record("openapi schema builds", response.status_code == 200, str(response.status_code))

        for path, label in (
            ("/debate/motions", "debate motions catalog"),
            ("/gd/topics", "GD topics catalog"),
        ):
            response = client.get(path)
            ok = response.status_code == 200 and isinstance(response.json(), list)
            count = len(response.json()) if ok else 0
            section.record(
                f"GET {path} -> {label}",
                ok and count > 0,
                f"{response.status_code}, {count} entries",
            )

        response = client.get("/profile/summary")
        ok = response.status_code == 200
        section.record("GET /profile/summary", ok, str(response.status_code))
        if ok:
            body = response.json()
            section.record(
                "profile payload has stats + recent lists",
                "stats" in body
                and {"recent_debates", "recent_gds", "recent_interviews"} <= body.keys(),
                ", ".join(sorted(body.keys())),
            )

        response = client.get("/admin/gd")
        section.record(
            "student is blocked from /admin/gd",
            response.status_code == 403,
            str(response.status_code),
        )

        # Same endpoint, teacher role.
        settings.TEACHER_EMAILS = "dev@kiet.edu"
        response = client.get("/admin/gd")
        section.record(
            "teacher can list GD sessions",
            response.status_code == 200 and isinstance(response.json(), list),
            str(response.status_code),
        )

        response = client.get("/admin/gd/does-not-exist")
        section.record(
            "unknown GD session returns 404",
            response.status_code == 404,
            str(response.status_code),
        )

        response = client.get("/admin/submissions/does-not-exist/video")
        section.record(
            "missing interview video returns 404, not 500",
            response.status_code == 404,
            str(response.status_code),
        )

    except Exception as exc:  # noqa: BLE001
        section.error = f"{type(exc).__name__}: {exc}"
    finally:
        settings.AUTH_BYPASS = original_bypass
        settings.TEACHER_EMAILS = original_teachers
        client.close()
