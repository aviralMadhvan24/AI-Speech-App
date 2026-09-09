"""Getting the nudge out of the app.

The programme's failure mode is silence, and a warning that lives inside the
app is read only by people who opened the app — which excludes, precisely, the
pairings that have gone quiet. These pin the two rules that make an unattended
daily job safe to point at a cohort:

- it never sends the same person twice in a day, because the box is stopped
  between demos and a persistent timer catches up on boot; and
- a missing address is a person not being reached, not an error to swallow.

The mailer's `none` backend is covered here too, because it is the production
default until SES leaves sandbox — a "stub" that ships is not a stub.
"""

from __future__ import annotations

import importlib
import json
from types import SimpleNamespace

import pytest

from app.core import mailer


# --- The transport --------------------------------------------------------


def test_the_default_backend_reports_success_without_sending(monkeypatch, caplog):
    """`none` is the shipped default, so it must behave like a working sink."""
    monkeypatch.setattr(mailer.settings, "MAIL_PROVIDER", "none")

    with caplog.at_level("INFO"):
        assert mailer.send("someone@x.test", "Subject", "Body") is True

    assert "mail_would_send" in caplog.text
    assert "someone@x.test" in caplog.text


def test_the_body_is_not_logged_at_info(monkeypatch, caplog):
    """A nudge body is somebody's own pairing history.

    On a shared box anyone with shell access reads INFO by default, and the
    subject alone is enough to confirm the job ran.
    """
    monkeypatch.setattr(mailer.settings, "MAIL_PROVIDER", "none")

    with caplog.at_level("INFO"):
        mailer.send("someone@x.test", "Subject", "silent 12 days with Ada")

    assert "silent 12 days" not in caplog.text


def test_no_recipient_is_a_failed_send_not_a_crash(monkeypatch):
    """A caller that could not resolve an address is a real, reportable state."""
    monkeypatch.setattr(mailer.settings, "MAIL_PROVIDER", "none")
    assert mailer.send("", "Subject", "Body") is False


def test_an_unknown_provider_falls_back_rather_than_dropping_the_mail(
    monkeypatch, caplog
):
    """A typo in the environment must not silently stop the digest."""
    monkeypatch.setattr(mailer.settings, "MAIL_PROVIDER", "sess")

    with caplog.at_level("INFO"):
        assert mailer.send("someone@x.test", "Subject", "Body") is True

    assert "mail_unknown_provider" in caplog.text


def test_ses_failures_are_reported_not_raised(monkeypatch):
    """A mail outage must not take down the job that triggered it."""
    monkeypatch.setattr(mailer.settings, "MAIL_PROVIDER", "ses")

    def _boom(*_args, **_kwargs):
        raise RuntimeError("Email address is not verified")

    monkeypatch.setattr(mailer, "_send_via_ses", lambda *a, **k: False)
    assert mailer.send("someone@x.test", "Subject", "Body") is False

    # And the real path swallows the SDK's exception rather than propagating.
    monkeypatch.setattr(mailer, "_send_via_ses", mailer._send_via_ses)
    monkeypatch.setitem(
        __import__("sys").modules, "boto3", SimpleNamespace(client=_boom)
    )
    assert mailer.send("someone@x.test", "Subject", "Body") is False


# --- The job --------------------------------------------------------------


@pytest.fixture()
def script(tmp_path, monkeypatch):
    """The digest script, with its send log pointed at a temp file."""
    monkeypatch.chdir(tmp_path)
    module = importlib.import_module("scripts.send_buddy_digest")
    importlib.reload(module)
    monkeypatch.setattr(module, "SENT_LOG", tmp_path / "sent.jsonl")
    return module


def _nudge(user_id: str, email: str | None, message: str = "Say something"):
    return SimpleNamespace(
        user_id=user_id,
        person=SimpleNamespace(user_id=user_id, email=email, name=None),
        role="mentee",
        pair_id="pair-1",
        partner=None,
        state="quiet",
        days_quiet=9,
        days_overdue=None,
        message=message,
        priority=1,
        sessions_kept=2,
    )


def test_a_second_run_the_same_day_sends_nothing(script, monkeypatch):
    """The timer is Persistent, and the box is started more than once a day."""
    sent: list[str] = []
    monkeypatch.setattr(
        script.digest_module,
        "build_digest",
        lambda: SimpleNamespace(total=1, nudges=[_nudge("u-1", "one@x.test")]),
    )
    monkeypatch.setattr(script, "send", lambda to, *a, **k: sent.append(to) or True)

    assert script.main([]) == 0
    assert sent == ["one@x.test"]

    assert script.main([]) == 0
    assert sent == ["one@x.test"], "the second run must not mail them again"


def test_a_dry_run_records_nothing_so_it_cannot_suppress_the_real_one(
    script, monkeypatch
):
    monkeypatch.setattr(
        script.digest_module,
        "build_digest",
        lambda: SimpleNamespace(total=1, nudges=[_nudge("u-1", "one@x.test")]),
    )
    monkeypatch.setattr(script, "send", lambda *a, **k: pytest.fail("dry run sent mail"))

    assert script.main(["--dry-run"]) == 0
    assert not script.SENT_LOG.exists()


def test_someone_with_no_address_is_reported_rather_than_skipped_silently(
    script, monkeypatch, capsys
):
    """It means a real person is not being reached, which is worth saying."""
    monkeypatch.setattr(
        script.digest_module,
        "build_digest",
        lambda: SimpleNamespace(total=1, nudges=[_nudge("u-ghost", None)]),
    )
    monkeypatch.setattr(script.identity, "email_for", lambda _uid: None)
    monkeypatch.setattr(script, "send", lambda *a, **k: pytest.fail("sent to nobody"))

    assert script.main([]) == 0
    assert "no address on file" in capsys.readouterr().out


def test_one_message_per_person_not_per_pairing(script, monkeypatch):
    """A mentor holding three silent pairings is one conversation, not three."""
    bodies: list[str] = []
    monkeypatch.setattr(
        script.digest_module,
        "build_digest",
        lambda: SimpleNamespace(
            total=3,
            nudges=[
                _nudge("u-1", "one@x.test", "First"),
                _nudge("u-1", "one@x.test", "Second"),
                _nudge("u-2", "two@x.test", "Third"),
            ],
        ),
    )
    monkeypatch.setattr(
        script, "send", lambda _to, _s, body: bodies.append(body) or True
    )

    assert script.main([]) == 0
    assert len(bodies) == 2
    assert "First" in bodies[0] and "Second" in bodies[0]


def test_a_failed_send_exits_non_zero_so_the_timer_shows_it(script, monkeypatch):
    monkeypatch.setattr(
        script.digest_module,
        "build_digest",
        lambda: SimpleNamespace(total=1, nudges=[_nudge("u-1", "one@x.test")]),
    )
    monkeypatch.setattr(script, "send", lambda *a, **k: False)

    assert script.main([]) == 1
    # Nothing recorded, so the next run tries again rather than assuming it went.
    assert not script.SENT_LOG.exists()


def test_a_corrupt_row_in_the_send_log_does_not_remail_everyone(script):
    """Skip the bad line, keep the rest — the opposite is a cohort spammed."""
    script.SENT_LOG.parent.mkdir(parents=True, exist_ok=True)
    today = script._today()
    script.SENT_LOG.write_text(
        "{not json\n" + json.dumps({"date": today, "user_id": "u-1"}) + "\n",
        encoding="utf-8",
    )

    assert script.already_sent_today() == {"u-1"}
