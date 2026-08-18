"""JSONL-backed storage stores.

This package is the swap-point for moving to a real database later. Each
store exposes a small typed API so callers depend on the protocol, not
the file format. To migrate to Postgres / SQLite, swap the store
implementations behind the same interface — call sites don't change.
"""

from .buddy import BuddyCycle
from .buddy import BuddyCyclesStore
from .buddy import BuddyMessage
from .buddy import BuddyMessagesStore
from .buddy import BuddyPair
from .buddy import BuddyPairsStore
from .buddy import BuddySession
from .buddy import BuddySessionsStore
from .buddy import CycleBaseline
from .buddy import MentorRecord
from .buddy import MentorsStore
from .buddy import buddy_cycles_store
from .buddy import buddy_sessions_store
from .buddy import buddy_messages_store
from .buddy import buddy_pairs_store
from .buddy import mentors_store
from .reviews import InterviewReview
from .reviews import ReviewsStore
from .reviews import reviews_store
from .submissions import InterviewSubmission
from .submissions import SubmissionsStore
from .submissions import submissions_store
from .users import UserRecord
from .users import UsersStore
from .users import users_store


__all__ = [
    "BuddyCycle",
    "BuddyCyclesStore",
    "BuddyMessage",
    "BuddyMessagesStore",
    "BuddyPair",
    "BuddyPairsStore",
    "BuddySession",
    "BuddySessionsStore",
    "CycleBaseline",
    "InterviewReview",
    "InterviewSubmission",
    "MentorRecord",
    "MentorsStore",
    "ReviewsStore",
    "SubmissionsStore",
    "UserRecord",
    "UsersStore",
    "buddy_cycles_store",
    "buddy_messages_store",
    "buddy_sessions_store",
    "buddy_pairs_store",
    "mentors_store",
    "reviews_store",
    "submissions_store",
    "users_store",
]
