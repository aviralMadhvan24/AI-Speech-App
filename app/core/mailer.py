"""Outbound mail, behind one function.

The buddy programme's whole failure mode is silence: `app.buddy.health`
detects a pairing that has stopped, and `app.buddy.digest` turns that into an
addressed worklist — but a stalled pairing is precisely the one nobody is
opening the app to look at, so a warning that lives inside the app is a
warning nobody reads. Something has to leave.

Two backends, chosen by ``settings.MAIL_PROVIDER``:

- ``none`` (the default) logs the message and reports success. This is not a
  stub to be replaced later — it is how the digest stays runnable, testable
  and deployable before any credentials exist, and how a deployment with no
  mail configured degrades to "the app still works" rather than to a crash on
  a scheduled job nobody is watching.
- ``ses`` sends through Amazon SES.

The caller never learns which one ran. A send that failed returns ``False``
and is logged; it never raises, because a mail outage must not take down the
request or the job that triggered it.

SES note, and it is the reason ``none`` is the default: a new SES account is
in *sandbox*, which delivers only to verified recipients and caps sending at
200 messages a day. A classroom cannot be reached from a sandbox account no
matter how correct this file is. Verifying a sender identity and requesting
production access are both console actions, and neither is code.
"""

from __future__ import annotations

from typing import Optional

from app.core.config import settings
from app.core.logger import logger


def _send_via_log(to: str, subject: str, body_text: str) -> bool:
    """Record what would have gone out. Always succeeds.

    Logs the recipient and subject at INFO and the body at DEBUG: on a shared
    box the subject alone is enough to confirm the job ran, and the body is a
    student's own pairing history, which does not belong in a log that anyone
    with shell access reads by default.
    """
    logger.info("mail_would_send to=%s subject=%s", to, subject)
    logger.debug("mail_body to=%s\n%s", to, body_text)
    return True


def _send_via_ses(
    to: str, subject: str, body_text: str, body_html: Optional[str]
) -> bool:
    try:
        import boto3
    except ImportError:
        logger.error("mail_ses_unavailable boto3 is not installed")
        return False

    body: dict = {"Text": {"Data": body_text, "Charset": "UTF-8"}}
    if body_html:
        body["Html"] = {"Data": body_html, "Charset": "UTF-8"}

    try:
        client = boto3.client(
            "ses",
            region_name=settings.AWS_REGION,
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        )
        response = client.send_email(
            Source=settings.MAIL_FROM,
            Destination={"ToAddresses": [to]},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": body,
            },
        )
    except Exception as exc:
        # Includes the sandbox rejection for an unverified recipient, which is
        # the most likely failure on a fresh account and is worth reading in
        # full rather than as an exception class.
        logger.warning("mail_ses_failed to=%s err=%s", to, exc)
        return False

    logger.info(
        "mail_sent to=%s subject=%s id=%s",
        to,
        subject,
        response.get("MessageId", "?"),
    )
    return True


def send(
    to: str,
    subject: str,
    body_text: str,
    body_html: Optional[str] = None,
) -> bool:
    """Send one message. Returns whether it went.

    Never raises. An empty recipient is a caller that could not resolve an
    address — that is a real condition (a user the platform has never seen has
    no address to resolve), so it is reported as a failed send rather than
    treated as an error.
    """
    if not to:
        logger.warning("mail_no_recipient subject=%s", subject)
        return False

    provider = (settings.MAIL_PROVIDER or "none").strip().lower()
    if provider == "ses":
        return _send_via_ses(to, subject, body_text, body_html)
    if provider != "none":
        # A typo in the environment must not silently stop the mail: fall back
        # to the log backend so the job still reports what it wanted to send.
        logger.warning("mail_unknown_provider provider=%s — logging instead", provider)
    return _send_via_log(to, subject, body_text)
