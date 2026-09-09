"""Who a buddy row is about, resolved in one place.

Every buddy row is keyed on ``user_id`` — the platform's own user id
(``User.uid``, the Firebase uid), which is the same id debates and GD have
always recorded in ``participants[].user_id``. The programme used to key on
email instead, and that was wrong in three separate ways:

- an email is a *mutable* attribute of an account, so a student who changes
  theirs silently loses their pairing, their cycle and their whole history;
- it forced every join against debates and GD through a lookup table, because
  those stores never knew anything but the uid;
- it put a personal identifier in every stored row of a classroom tool, where
  the id alone would have done.

So storage holds ids, and the *display* of a person — their name and email —
is resolved here, at the API boundary, from ``users_store``. Display data is
never stored alongside a buddy row: a denormalised copy is a copy that goes
stale, and the whole point of keying on an id is that the record follows the
person rather than the label.

Two stores still key on email and cannot be changed from here — interview
submissions and pronunciation attempts, both of which record
``student_email``. ``email_for`` exists for exactly that join, and is the only
sanctioned direction back.
"""

from __future__ import annotations

import logging
from typing import Iterable
from typing import Optional

from pydantic import BaseModel

from app.storage import users_store

logger = logging.getLogger("buddy.identity")


class Person(BaseModel):
    """One human, as the API describes them to a client.

    ``user_id`` is the identity; ``name`` and ``email`` are decoration and may
    both be absent for a user who has not been seen since the users log was
    introduced. ``label`` is what a UI should print when it needs one string.
    """

    user_id: str
    email: Optional[str] = None
    name: Optional[str] = None
    role: Optional[str] = None

    @property
    def label(self) -> str:
        return self.name or self.email or self.user_id


# A person we hold an id for but know nothing else about. Returned rather than
# None so a caller rendering a list never has to branch: a pairing with one
# unknown participant is still a pairing, and hiding it would hide the problem.
def _unknown(user_id: str) -> Person:
    return Person(user_id=user_id)


def _records() -> list:
    try:
        return users_store.list_all()
    except Exception as exc:  # a malformed users log must not blank a panel
        logger.warning("buddy_identity_users_failed err=%s", type(exc).__name__)
        return []


def _to_person(record) -> Person:
    return Person(
        user_id=record.firebase_uid,
        email=record.email,
        name=record.display_name,
        role=record.role,
    )


def resolve(user_id: Optional[str]) -> Optional[Person]:
    """One person by id. ``None`` in, ``None`` out; unknown id, bare Person."""
    if not user_id:
        return None
    for record in _records():
        if record.firebase_uid == user_id:
            return _to_person(record)
    return _unknown(user_id)


def resolve_many(user_ids: Iterable[str]) -> dict[str, Person]:
    """Several people in ONE pass over the users log, keyed by id.

    Every list endpoint should use this rather than calling ``resolve`` per
    row: the users log is a JSONL file that is re-read on each call, so the
    naive way re-reads it once per person on screen.
    """
    wanted = {uid for uid in user_ids if uid}
    if not wanted:
        return {}

    found = {
        record.firebase_uid: _to_person(record)
        for record in _records()
        if record.firebase_uid in wanted
    }
    for uid in wanted - set(found):
        found[uid] = _unknown(uid)
    return found


def email_for(user_id: Optional[str]) -> Optional[str]:
    """The email behind an id, for joining against the email-keyed stores.

    Interview submissions and pronunciation attempts record ``student_email``
    and nothing else, so reading a student's own scored work still has to go
    through here. Returns None for a user the platform has never seen, and
    callers must treat that as "no work found" rather than guessing.
    """
    person = resolve(user_id)
    return person.email if person else None


def id_for_email(email: Optional[str]) -> Optional[str]:
    """The id behind an email. For migration and for admin lookup by address.

    Not for use on a request path that already has ``User.uid`` — going the
    long way round through an email is what this module exists to stop.
    """
    if not email:
        return None
    normalized = email.strip().lower()
    for record in _records():
        if record.email.lower() == normalized:
            return record.firebase_uid
    return None


def students() -> list[Person]:
    """Every student the platform has seen, for the teacher's pairing picker."""
    return [_to_person(r) for r in _records() if r.role == "student"]
