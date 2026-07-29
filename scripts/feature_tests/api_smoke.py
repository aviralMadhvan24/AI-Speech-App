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

from .harness import Report, Section


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

        _check_topic_catalog(section, client, "debate motion", "/admin/debate-motions", "/debate/motions")
        _check_topic_catalog(section, client, "GD topic", "/admin/gd-topics", "/gd/topics")

        # Role gate on the catalog endpoints, checked as a student.
        settings.TEACHER_EMAILS = "someone.else@kiet.edu"
        for admin_path in ("/admin/debate-motions", "/admin/gd-topics"):
            blocked = client.get(admin_path).status_code == 403 and (
                client.post(
                    admin_path,
                    json={"title": "Blocked attempt", "text": "x" * 40},
                ).status_code
                == 403
            )
            section.record(
                f"student cannot read or write {admin_path}",
                blocked,
                "403 on GET and POST",
            )

    except Exception as exc:  # noqa: BLE001
        section.error = f"{type(exc).__name__}: {exc}"
    finally:
        settings.AUTH_BYPASS = original_bypass
        settings.TEACHER_EMAILS = original_teachers
        client.close()


def _check_topic_catalog(
    section: Section,
    client,
    label: str,
    admin_path: str,
    student_path: str,
) -> None:
    """Add a catalog entry, confirm students see it, then remove it.

    Runs against the real store, so it deletes what it creates. Built-in
    catalog entries are asserted to stay read-only.
    """
    before = client.get(admin_path)
    if before.status_code != 200:
        section.record(f"GET {admin_path}", False, str(before.status_code))
        return
    baseline = len(before.json())

    created = client.post(
        admin_path,
        json={
            "title": f"Feature test {label}",
            "text": (
                f"Automated feature-test {label} body, long enough to pass validation "
                "and removed again at the end of this check."
            ),
            "category": "feature-test",
        },
    )
    if created.status_code != 201:
        section.record(
            f"teacher can add a {label}",
            False,
            f"{created.status_code} {created.text[:120]}",
        )
        return
    entry_id = created.json()["id"]
    section.record(f"teacher can add a {label}", True, f"id={entry_id}")

    try:
        catalog = client.get(admin_path).json()
        section.record(
            f"added {label} appears in the admin catalog",
            len(catalog) == baseline + 1
            and any(e["id"] == entry_id and e["is_custom"] for e in catalog),
            f"{len(catalog)} entries, was {baseline}",
        )

        student_view = client.get(student_path)
        section.record(
            f"added {label} is offered to students",
            student_view.status_code == 200
            and any(e["id"] == entry_id for e in student_view.json()),
            f"{student_path} -> {len(student_view.json())} entries",
        )

        short = client.post(admin_path, json={"title": "x", "text": "too short"})
        section.record(
            f"{label} validation rejects thin input",
            short.status_code == 422,
            str(short.status_code),
        )

        builtin = next((e["id"] for e in catalog if not e["is_custom"]), None)
        if builtin:
            readonly = client.delete(f"{admin_path}/{builtin}")
            section.record(
                f"built-in {label} cannot be deleted",
                readonly.status_code == 403,
                f"{readonly.status_code} {readonly.json().get('detail')}",
            )
    finally:
        removed = client.delete(f"{admin_path}/{entry_id}")
        section.record(
            f"added {label} can be deleted",
            removed.status_code == 200,
            str(removed.status_code),
        )
        section.record(
            f"{label} catalog returns to its original size",
            len(client.get(admin_path).json()) == baseline,
            f"{len(client.get(admin_path).json())} vs {baseline} baseline",
        )
