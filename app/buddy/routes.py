"""Buddy mentorship endpoints — student conversations and teacher administration.

Mentors are students who already demonstrate strong speaking scores; the system
suggests them and a teacher approves. An approved mentor is paired with a mentee
by a teacher, and the pair then talks 1:1 over text and asynchronous voice notes.

Access rule: a student may only touch a pair they belong to. Teachers may read
any pair, since they created the pairing and are responsible for it.

Identity: every person is addressed by ``user_id`` (``User.uid``) — in path
parameters, in request bodies and in stored rows. Names and addresses appear
in responses only, resolved per request by ``app.buddy.identity``.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime
from datetime import timedelta
from datetime import timezone
from pathlib import Path

from fastapi import APIRouter
from fastapi import Depends
from fastapi import File
from fastapi import HTTPException
from fastapi import UploadFile
from fastapi import status
from fastapi.responses import FileResponse

from app.auth import User
from app.auth import require_teacher
from app.auth import require_user
from app.buddy import digest
from app.buddy import growth
from app.buddy import health
from app.buddy import identity
from app.buddy import practice
from app.buddy import programme
from app.buddy import service
from app.buddy.identity import Person
from app.buddy.growth import CycleReport
from app.buddy.schemas import BuddyBadge
from app.buddy.schemas import CompleteSessionRequest
from app.buddy.schemas import ConcernsResponse
from app.buddy.schemas import DeclineRequestRequest
from app.buddy.schemas import ConversationSummary
from app.buddy.schemas import CreateCycleRequest
from app.buddy.schemas import CreatePairRequest
from app.buddy.schemas import CyclesResponse
from app.buddy.schemas import PlanSessionRequest
from app.buddy.schemas import SessionsResponse
from app.buddy.schemas import MarkReadResponse
from app.buddy.schemas import MentorCandidatesResponse
from app.buddy.schemas import MentorDecisionRequest
from app.buddy.schemas import MentorDashboard
from app.buddy.schemas import MentorsResponse
from app.buddy.schemas import MessagesResponse
from app.buddy.schemas import MyConcernResponse
from app.buddy.schemas import MyNudgesResponse
from app.buddy.schemas import MyRequestResponse
from app.buddy.schemas import OpenRoomResponse
from app.buddy.schemas import PracticePromptsResponse
from app.buddy.schemas import RaiseConcernRequest
from app.buddy.schemas import RateSessionRequest
from app.buddy.schemas import RequestBuddyRequest
from app.buddy.schemas import RequestsResponse
from app.buddy.schemas import ResolveConcernRequest
from app.buddy.schemas import StudentRow
from app.buddy.schemas import StudentsResponse
from app.buddy.schemas import SuggestedPairing
from app.buddy.schemas import SweepCyclesResponse
from app.buddy.schemas import MyBuddiesResponse
from app.buddy.schemas import PairsResponse
from app.buddy.schemas import SendMessageRequest
from app.storage.buddy import BuddyConcern
from app.storage.buddy import BuddyCycle
from app.storage.buddy import BuddyMessage
from app.storage.buddy import BuddyPair
from app.storage.buddy import BuddySession
from app.storage.buddy import buddy_concerns_store
from app.storage.buddy import buddy_cycles_store
from app.storage.buddy import buddy_messages_store
from app.storage.buddy import BuddyRequest
from app.storage.buddy import buddy_pairs_store
from app.storage.buddy import buddy_requests_store
from app.storage.buddy import buddy_sessions_store
from app.storage.buddy import mentors_store

logger = logging.getLogger("buddy.routes")

router = APIRouter(prefix="/buddy", tags=["buddy"])

# Voice notes are short by design — a spoken reply, not a recorded lecture.
# Well under the interview cap so a runaway recording fails fast.
MAX_VOICE_NOTE_BYTES = 10 * 1024 * 1024

MAX_MESSAGE_CHARS = 2000

# Reasons a mentee can attach to a session rating. Mixed praise and criticism
# on purpose: a list of only complaints turns the rating into a report card,
# and mentors stop reading it.
VALID_RATING_ASPECTS = (
    "prepared",
    "specific",
    "encouraging",
    "punctual",
    "unprepared",
    "vague",
    "harsh",
    "no_show",
)

MAX_RATING_NOTE_CHARS = 500


def _require_membership(pair_id: str, user: User) -> BuddyPair:
    """Fetch the pair, or raise 404/403. Teachers bypass the membership check."""
    pair = buddy_pairs_store.get(pair_id)
    if pair is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="pair_not_found",
        )
    if not (user.is_teacher or pair.involves(user.uid)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="not_your_conversation",
        )
    return pair


def _require_active_membership(pair_id: str, user: User) -> BuddyPair:
    """As `_require_membership`, but also refuses writes to an ended pair."""
    pair = _require_membership(pair_id, user)
    if pair.status != "active":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="conversation_ended",
        )
    if not pair.involves(user.uid):
        # A teacher may read a pair but is not a participant in it.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="not_a_participant",
        )
    return pair


def _person(user_id: str) -> Person:
    """One participant, for a response. Never None — an id the users log has
    not seen still describes a real row, and hiding it would hide the fault."""
    return identity.resolve(user_id) or Person(user_id=user_id)


# ---------------------------------------------------------------------------
# Student — conversations
# ---------------------------------------------------------------------------


NUDGE_FOR_STATE = {
    "no_cycle": "No cycle is running — ask your teacher to start one.",
    "not_started": "You haven't spoken yet. Send a first voice note.",
    "quiet": "It's been quiet for a week. Pick this back up.",
    "stalled": "This pairing has stalled — plan a session to restart it.",
}


@router.get("/me", response_model=MyBuddiesResponse)
async def my_buddies(current_user: User = Depends(require_user)) -> MyBuddiesResponse:
    """Every buddy conversation the current user belongs to, newest activity first."""
    conversations: list[ConversationSummary] = []

    my_pairs = buddy_pairs_store.list_for_user(current_user.uid)
    # One pass for the whole inbox rather than per conversation — both for
    # health and for the names, which would otherwise re-read the users log
    # once per pairing on screen.
    health_index = health.build_index(my_pairs)
    people = identity.resolve_many(
        [p.mentor_id for p in my_pairs] + [p.mentee_id for p in my_pairs]
    )

    for pair in my_pairs:
        partner_id = pair.partner_of(current_user.uid)
        if partner_id is None:
            continue
        messages = buddy_messages_store.list_for_pair(pair.pair_id)
        last = messages[-1] if messages else None
        is_mentor = pair.mentor_id == current_user.uid

        pair_health = health_index.get(pair.pair_id)
        cycle = buddy_cycles_store.active_for_pair(pair.pair_id)
        sessions = (
            buddy_sessions_store.list_for_cycle(cycle.cycle_id) if cycle else []
        )
        upcoming = [s for s in sessions if s.status == "planned"]

        conversations.append(
            ConversationSummary(
                pair_id=pair.pair_id,
                partner=people.get(partner_id) or Person(user_id=partner_id),
                my_role="mentor" if is_mentor else "mentee",
                status=pair.status,
                unread_count=buddy_messages_store.unread_count(
                    pair.pair_id, current_user.uid
                ),
                last_message_at=last.sent_at if last else None,
                last_message_preview=(
                    ("🎤 Voice note" if last.kind == "voice" else last.body[:80])
                    if last
                    else ""
                ),
                nudge=(
                    NUDGE_FOR_STATE.get(pair_health.state) if pair_health else None
                ),
                days_quiet=pair_health.days_quiet if pair_health else None,
                next_session_at=upcoming[0].scheduled_at if upcoming else None,
                sessions_kept=sum(1 for s in sessions if s.status == "completed"),
            )
        )

    conversations.sort(key=lambda c: c.last_message_at or "", reverse=True)
    return MyBuddiesResponse(
        me=_person(current_user.uid),
        conversations=conversations,
        total=len(conversations),
    )


@router.get("/pairs/{pair_id}/messages", response_model=MessagesResponse)
async def get_messages(
    pair_id: str,
    current_user: User = Depends(require_user),
) -> MessagesResponse:
    """Full message history for one conversation."""
    pair = _require_membership(pair_id, current_user)
    # A teacher reading the thread is not a participant, so there is no "other
    # side" from their point of view; show them the mentee, whose progress the
    # pairing exists to serve.
    partner_id = pair.partner_of(current_user.uid) or pair.mentee_id
    messages = buddy_messages_store.list_for_pair(pair_id)
    return MessagesResponse(
        pair_id=pair_id,
        partner=_person(partner_id),
        me=_person(current_user.uid),
        messages=messages,
        total=len(messages),
    )


@router.post("/pairs/{pair_id}/messages", response_model=BuddyMessage)
async def send_message(
    pair_id: str,
    body: SendMessageRequest,
    current_user: User = Depends(require_user),
) -> BuddyMessage:
    """Post a text message into the conversation."""
    _require_active_membership(pair_id, current_user)

    text = body.body.strip()
    if not text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="empty_message",
        )

    message = buddy_messages_store.create(
        pair_id=pair_id,
        sender_id=current_user.uid,
        kind="text",
        body=text[:MAX_MESSAGE_CHARS],
    )
    logger.info(
        "buddy_message pair=%s sender=%s kind=text", pair_id, current_user.uid
    )
    return message


@router.post("/pairs/{pair_id}/voice-notes", response_model=BuddyMessage)
async def send_voice_note(
    pair_id: str,
    audio: UploadFile = File(...),
    current_user: User = Depends(require_user),
) -> BuddyMessage:
    """Post an asynchronous voice note into the conversation.

    The uploaded container is kept as-is under ``uploads/``. Unlike the analysis
    pipeline, nothing here transcodes or deletes it — the recipient plays the
    original back, so it has to outlive the request.
    """
    from app.audio.storage import save_uploaded_audio

    _require_active_membership(pair_id, current_user)

    try:
        asset = await save_uploaded_audio(audio, max_bytes=MAX_VOICE_NOTE_BYTES)
    except HTTPException:
        # 415 unsupported format / 413 too large carry meaning to the client.
        raise
    except Exception as exc:
        logger.warning("buddy_voice_note_failed pair=%s err=%s", pair_id, type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not process the voice note.",
        )

    message = buddy_messages_store.create(
        pair_id=pair_id,
        sender_id=current_user.uid,
        kind="voice",
        audio_id=asset.audio_id,
        audio_path=asset.original_path,
    )
    logger.info(
        "buddy_message pair=%s sender=%s kind=voice bytes=%s",
        pair_id,
        current_user.uid,
        asset.size_bytes,
    )
    return message


@router.get("/messages/{message_id}/audio")
async def get_voice_note(
    message_id: str,
    current_user: User = Depends(require_user),
):
    """Stream a voice note back, gated on conversation membership.

    Served through this route rather than the static ``uploads/`` mount so a
    recording is only reachable by the two people in the conversation.
    """
    message = buddy_messages_store.get(message_id)
    if message is None or message.kind != "voice" or not message.audio_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="voice_note_not_found",
        )

    _require_membership(message.pair_id, current_user)

    # The stored path is server-generated, but resolve it against uploads/ and
    # confirm containment before opening — never trust a stored path as a key.
    uploads_root = Path("uploads").resolve()
    audio_path = Path(message.audio_path).resolve()
    if not str(audio_path).startswith(str(uploads_root) + os.sep):
        logger.warning("buddy_voice_note_outside_uploads message=%s", message_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="voice_note_not_found",
        )
    if not audio_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="voice_note_missing",
        )

    return FileResponse(str(audio_path))


@router.get("/pairs/{pair_id}/activity", response_model=CycleReport)
async def pair_activity(
    pair_id: str,
    current_user: User = Depends(require_user),
) -> CycleReport:
    """The mentee's scored work and growth for the pair's current cycle.

    Deliberately narrower than the teacher's view of a student: a mentor is a
    classmate, not staff, so this is bounded by the open cycle's window. The
    bound is applied here, before anything is serialised — filtering in the
    client would still put the rest of the student's record on the wire.
    """
    pair = _require_membership(pair_id, current_user)
    cycle = buddy_cycles_store.active_for_pair(pair_id)
    report = growth.build_report(cycle, pair.mentee_id)

    # The previous cycle's verdict rides along, so the two people who did the
    # work find out how it went. Teachers could already see it; the pair could
    # not, which made closing a cycle a purely administrative act to them.
    closed = [c for c in buddy_cycles_store.list_for_pair(pair_id) if c.status == "closed"]
    if closed:
        report.last_summary = closed[0].summary

    return report


@router.post("/pairs/{pair_id}/read", response_model=MarkReadResponse)
async def mark_read(
    pair_id: str,
    current_user: User = Depends(require_user),
) -> MarkReadResponse:
    """Mark the partner's messages in this conversation as read."""
    _require_membership(pair_id, current_user)
    marked = buddy_messages_store.mark_read(pair_id, current_user.uid)
    return MarkReadResponse(marked=marked)


# ---------------------------------------------------------------------------
# Sessions — the unit of practice inside a cycle
# ---------------------------------------------------------------------------


VALID_MODES = ("async_voice", "live_call", "in_person")


def _session_for_member(session_id: str, user: User) -> BuddySession:
    """Fetch a session and confirm the caller belongs to its pair."""
    session = buddy_sessions_store.get(session_id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="session_not_found",
        )
    _require_membership(session.pair_id, user)
    return session


@router.get("/pairs/{pair_id}/sessions", response_model=SessionsResponse)
async def list_sessions(
    pair_id: str,
    current_user: User = Depends(require_user),
) -> SessionsResponse:
    """Sessions in the pair's open cycle, earliest first."""
    _require_membership(pair_id, current_user)
    cycle = buddy_cycles_store.active_for_pair(pair_id)
    if cycle is None:
        return SessionsResponse()
    sessions = buddy_sessions_store.list_for_cycle(cycle.cycle_id)
    return SessionsResponse(sessions=sessions, total=len(sessions))


@router.post("/pairs/{pair_id}/sessions", response_model=BuddySession)
async def plan_session(
    pair_id: str,
    body: PlanSessionRequest,
    current_user: User = Depends(require_user),
) -> BuddySession:
    """Plan a session. Either side may — practice is not the mentor's to dictate."""
    _require_active_membership(pair_id, current_user)

    if body.mode not in VALID_MODES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"mode must be one of {', '.join(VALID_MODES)}",
        )

    # A session belongs to a cycle: without a period to sit in, there is
    # nothing for it to count towards.
    cycle = buddy_cycles_store.active_for_pair(pair_id)
    if cycle is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="no_active_cycle",
        )

    scheduled_at = body.scheduled_at.strip()
    if not scheduled_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="scheduled_at is required",
        )

    # Resolve the practice material against the real catalog, so a session can
    # never point at a prompt that does not exist.
    prompt = None
    if body.prompt_kind and body.prompt_id:
        prompt = practice.find(body.prompt_kind, body.prompt_id)
        if prompt is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="prompt_not_found",
            )

    session = buddy_sessions_store.create(
        pair_id=pair_id,
        cycle_id=cycle.cycle_id,
        scheduled_at=scheduled_at,
        created_by_id=current_user.uid,
        topic=body.topic.strip()[:200],
        mode=body.mode,
        prompt_kind=prompt.kind if prompt else None,
        prompt_id=prompt.id if prompt else None,
        prompt_title=prompt.title if prompt else None,
    )
    logger.info(
        "buddy_session_planned pair=%s mode=%s by=%s",
        pair_id,
        body.mode,
        current_user.uid,
    )
    return session


@router.post("/sessions/{session_id}/complete", response_model=BuddySession)
async def complete_session(
    session_id: str,
    body: CompleteSessionRequest,
    current_user: User = Depends(require_user),
) -> BuddySession:
    """Mark a session done, recording the caller's own note.

    Both sides may call this on the same session — the mentor's observation and
    the mentee's reflection are separate fields, so neither overwrites the other.
    """
    session = _session_for_member(session_id, current_user)
    pair = buddy_pairs_store.get(session.pair_id)
    is_mentor = pair is not None and pair.mentor_id == current_user.uid

    updated = buddy_sessions_store.complete(
        session_id=session_id,
        note=body.note.strip()[:2000],
        is_mentor=is_mentor,
        duration_minutes=body.duration_minutes,
    )
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="session_not_found",
        )
    logger.info(
        "buddy_session_completed session=%s by=%s mentor=%s",
        session_id,
        current_user.uid,
        is_mentor,
    )
    return updated


@router.post("/sessions/{session_id}/miss", response_model=BuddySession)
async def miss_session(
    session_id: str,
    current_user: User = Depends(require_user),
) -> BuddySession:
    """Record that a planned session did not happen.

    Kept rather than deleted: a missed session is exactly the signal a teacher
    needs to see when a pairing quietly stops working.
    """
    _session_for_member(session_id, current_user)
    updated = buddy_sessions_store.mark_missed(session_id)
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="session_not_found",
        )
    return updated


@router.post("/sessions/{session_id}/rate", response_model=BuddySession)
async def rate_session(
    session_id: str,
    body: RateSessionRequest,
    current_user: User = Depends(require_user),
) -> BuddySession:
    """Rate a completed session, 1-5. Mentees only.

    The one signal the platform has about whether a mentor is good AT
    MENTORING rather than merely a strong speaker, which is what got them
    selected. Restricted to the mentee on purpose: a mentor rating their own
    session would make the number worthless.
    """
    session = _session_for_member(session_id, current_user)
    pair = buddy_pairs_store.get(session.pair_id)
    if pair is None or pair.mentee_id != current_user.uid:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="only_the_mentee_may_rate",
        )
    if session.status != "completed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="session_not_completed",
        )
    if not 1 <= body.rating <= 5:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="rating must be between 1 and 5",
        )

    aspects = [a.strip().lower() for a in body.aspects if a and a.strip()]
    if any(a not in VALID_RATING_ASPECTS for a in aspects):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid_aspect",
        )
    # Duplicates would double-count the same reason in any future tally, and
    # mean nothing to a mentor reading them.
    aspects = list(dict.fromkeys(aspects))

    note = (body.note or "").strip()
    if len(note) > MAX_RATING_NOTE_CHARS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="note_too_long",
        )

    updated = buddy_sessions_store.rate(session_id, body.rating, aspects, note)
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="session_not_found",
        )
    return updated


@router.get("/practice-prompts", response_model=PracticePromptsResponse)
async def practice_prompts(
    kind: str | None = None,
    _: User = Depends(require_user),
) -> PracticePromptsResponse:
    """The catalogs a session's practice material can be drawn from."""
    if kind is not None and kind not in ("pronunciation", "debate", "gd"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="kind must be pronunciation, debate or gd",
        )
    prompts = practice.list_prompts(kind)
    return PracticePromptsResponse(prompts=prompts, total=len(prompts))


@router.get("/my-mentoring", response_model=MentorDashboard)
async def my_mentoring(
    current_user: User = Depends(require_user),
) -> MentorDashboard:
    """What the caller's mentoring has amounted to.

    Mentoring is unpaid work that accrued nothing to the person doing it.
    Everything here is derived — nothing new is stored to produce it.
    """
    me = current_user.uid
    my_pairs = [p for p in buddy_pairs_store.list_all() if p.mentor_id == me]
    if not my_pairs:
        return MentorDashboard(is_mentor=mentors_store.is_approved(me))

    sessions_mentored = 0
    ratings: list[float] = []
    for pair in my_pairs:
        for session in buddy_sessions_store.list_for_pair(pair.pair_id):
            if session.status != "completed":
                continue
            sessions_mentored += 1
            if session.mentee_rating is not None:
                ratings.append(float(session.mentee_rating))

    pair_ids = {p.pair_id for p in my_pairs}
    closed = [
        c
        for c in buddy_cycles_store.list_all()
        if c.pair_id in pair_ids and c.status == "closed"
    ]

    return MentorDashboard(
        is_mentor=True,
        active_mentees=sum(1 for p in my_pairs if p.status == "active"),
        total_mentees=len({p.mentee_id for p in my_pairs}),
        sessions_mentored=sessions_mentored,
        average_rating=round(sum(ratings) / len(ratings), 2) if ratings else None,
        cycles_completed=len(closed),
        # Only cycles that closed with a verdict count — an unmeasured cycle
        # is not a win, and claiming it as one would be the easiest lie here.
        mentees_improved=sum(
            1 for c in closed if c.summary is not None and c.summary.verdict == "improved"
        ),
    )


@router.delete("/sessions/{session_id}", status_code=204, response_model=None)
async def cancel_session(
    session_id: str,
    current_user: User = Depends(require_user),
) -> None:
    """Cancel a session that was never going to happen.

    Only a session still in `planned` can go — once it has been completed or
    marked missed it is part of the cycle's record.
    """
    session = _session_for_member(session_id, current_user)
    if session.status != "planned":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="session_already_resolved",
        )
    buddy_sessions_store.delete(session_id)


# ---------------------------------------------------------------------------
# Teacher — mentor approval and pairing
# ---------------------------------------------------------------------------


@router.get("/admin/mentor-candidates", response_model=MentorCandidatesResponse)
async def mentor_candidates(
    _: User = Depends(require_teacher),
) -> MentorCandidatesResponse:
    """Students the scores put forward as mentors, plus the full ranking behind it."""
    return MentorCandidatesResponse(
        suggested=service.suggested_mentors(),
        ranking=service.rank_speakers(),
        threshold=service.SUGGESTION_THRESHOLD,
        min_sample_size=service.MIN_SAMPLE_SIZE,
        growth_min_gain=service.GROWTH_MIN_GAIN,
        growth_min_final=service.GROWTH_MIN_FINAL,
    )


def _mentors_response() -> MentorsResponse:
    mentors = mentors_store.list_all()
    return MentorsResponse(
        mentors=mentors,
        total=len(mentors),
        people=identity.resolve_many(
            [m.user_id for m in mentors] + [m.decided_by_id or "" for m in mentors]
        ),
    )


@router.get("/admin/mentors", response_model=MentorsResponse)
async def list_mentors(_: User = Depends(require_teacher)) -> MentorsResponse:
    """Every mentor decision a teacher has recorded."""
    return _mentors_response()


@router.post("/admin/mentors/{user_id}/decision", response_model=MentorsResponse)
async def decide_mentor(
    user_id: str,
    body: MentorDecisionRequest,
    current_user: User = Depends(require_teacher),
) -> MentorsResponse:
    """Approve or reject a suggested mentor."""
    if body.status not in ("approved", "rejected"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="status must be 'approved' or 'rejected'",
        )

    # Carry the current score onto the record so the decision keeps the
    # evidence it was made on, even as later attempts move the live ranking.
    ranking = next(
        (r for r in service.rank_speakers() if r.user_id == user_id),
        None,
    )
    mentors_store.set_status(
        user_id=user_id,
        status=body.status,
        decided_by_id=current_user.uid,
        speaking_score=ranking.speaking_score if ranking else 0.0,
        sample_size=ranking.sample_size if ranking else 0,
    )
    logger.info(
        "buddy_mentor_decision user=%s status=%s by=%s",
        user_id,
        body.status,
        current_user.uid,
    )
    return _mentors_response()


@router.get("/admin/programme", response_model=programme.ProgrammeReport)
async def programme_report(
    _: User = Depends(require_teacher),
) -> programme.ProgrammeReport:
    """The whole programme in one object — the "is this working" question.

    Every other admin endpoint returns a list, which answers about one pairing
    at a time. This is the only place that answers about the programme, and it
    is what a department head asks before funding another semester.
    """
    return programme.build_report()


@router.get("/admin/digest", response_model=digest.BuddyDigest)
async def buddy_digest(
    _: User = Depends(require_teacher),
) -> digest.BuddyDigest:
    """Everyone who needs chasing, most urgent first.

    The inbox nudge only reaches whoever opens the buddy tab, and the pairings
    that need chasing are the ones nobody is opening. This is the same
    information pointed outward, at the person who can actually go and find
    the student in a corridor.
    """
    return digest.build_digest()


@router.get("/admin/pairs", response_model=PairsResponse)
async def list_pairs(_: User = Depends(require_teacher)) -> PairsResponse:
    """Every buddy pairing, active or ended, with how each one is actually going.

    Health rides along with the list rather than sitting behind its own call:
    the reason to look at this list at all is to find the pairing that has
    stopped, and a second request would let the two drift apart on screen.
    """
    pairs = buddy_pairs_store.list_all()
    pairs.sort(key=lambda p: p.created_at, reverse=True)
    return PairsResponse(
        pairs=pairs,
        total=len(pairs),
        health=health.build_index(pairs),
        open_concerns=buddy_concerns_store.open_count_by_pair(),
        people=identity.resolve_many(
            [p.mentor_id for p in pairs]
            + [p.mentee_id for p in pairs]
            + [p.created_by_id for p in pairs]
        ),
    )


@router.post("/admin/pairs", response_model=BuddyPair)
async def create_pair(
    body: CreatePairRequest,
    current_user: User = Depends(require_teacher),
) -> BuddyPair:
    """Pair an approved mentor with a mentee."""
    mentor_id = body.mentor_id.strip()
    mentee_id = body.mentee_id.strip()

    if not mentor_id or not mentee_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="both mentor_id and mentee_id are required",
        )
    if mentor_id == mentee_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="a student cannot mentor themselves",
        )
    if not mentors_store.is_approved(mentor_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="mentor_not_approved",
        )
    if buddy_pairs_store.find_active_between(mentor_id, mentee_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="pair_already_active",
        )
    # One mentor at a time. Two people coaching the same student to different
    # plans is worse for them than one, and it makes every per-mentee number
    # in the programme report ambiguous about who to credit.
    existing = buddy_pairs_store.active_for_mentee(mentee_id)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="mentee_already_paired",
        )

    pair = buddy_pairs_store.create(
        mentor_id=mentor_id,
        mentee_id=mentee_id,
        created_by_id=current_user.uid,
    )
    logger.info(
        "buddy_pair_created mentor=%s mentee=%s by=%s",
        mentor_id,
        mentee_id,
        current_user.uid,
    )

    # A student who asked for a mentor and has now been given one should not
    # still be sitting in the queue. Clearing it here means a teacher pairing
    # someone never has to remember to also tick off the request that asked.
    buddy_requests_store.resolve_for_user(
        mentee_id, resolved_by_id=current_user.uid, pair_id=pair.pair_id
    )

    # Pairing without a period is what the cycle work exists to fix, so the
    # first one opens here unless the teacher explicitly asked for none.
    if body.cycle_weeks > 0:
        _open_cycle(
            pair=pair,
            weeks=body.cycle_weeks,
            goal=body.goal,
            focus_area=body.focus_area,
            created_by_id=current_user.uid,
        )

    return pair


# ---------------------------------------------------------------------------
# Teacher — cycles
# ---------------------------------------------------------------------------


def _open_cycle(
    pair: BuddyPair,
    weeks: int,
    goal: str,
    focus_area: str | None,
    created_by_id: str,
) -> BuddyCycle:
    """Open a cycle on a pair, capturing the mentee's standing as it starts."""
    if weeks < 1 or weeks > 52:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="weeks must be between 1 and 52",
        )

    now = datetime.now(timezone.utc)
    try:
        return buddy_cycles_store.create(
            pair_id=pair.pair_id,
            mentee_id=pair.mentee_id,
            starts_at=now.isoformat(),
            ends_at=(now + timedelta(weeks=weeks)).isoformat(),
            created_by_id=created_by_id,
            goal=goal.strip(),
            focus_area=focus_area,
            baseline=growth.baseline_for(pair.mentee_id, now.isoformat()),
        )
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="cycle_already_active",
        )


@router.get("/admin/cycles", response_model=CyclesResponse)
async def list_cycles(_: User = Depends(require_teacher)) -> CyclesResponse:
    """Every cycle across every pair, newest first."""
    cycles = buddy_cycles_store.list_all()
    cycles.sort(key=lambda c: c.starts_at, reverse=True)
    overdue = buddy_cycles_store.list_expired()
    return CyclesResponse(
        cycles=cycles,
        total=len(cycles),
        overdue=overdue,
        people=identity.resolve_many([c.mentee_id for c in cycles]),
    )


@router.post("/admin/cycles", response_model=BuddyCycle)
async def create_cycle(
    body: CreateCycleRequest,
    current_user: User = Depends(require_teacher),
) -> BuddyCycle:
    """Open a cycle on an existing pair — a renewal, or a first period."""
    pair = buddy_pairs_store.get(body.pair_id)
    if pair is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="pair_not_found",
        )
    if pair.status != "active":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="pair_ended",
        )

    cycle = _open_cycle(
        pair=pair,
        weeks=body.weeks,
        goal=body.goal,
        focus_area=body.focus_area,
        created_by_id=current_user.uid,
    )
    logger.info(
        "buddy_cycle_opened pair=%s weeks=%s by=%s",
        pair.pair_id,
        body.weeks,
        current_user.uid,
    )
    return cycle


@router.post("/admin/cycles/{cycle_id}/close", response_model=BuddyCycle)
async def close_cycle(
    cycle_id: str,
    current_user: User = Depends(require_teacher),
) -> BuddyCycle:
    """Close a cycle, recording what it achieved. The pair stays active.

    The summary is computed here, once, and stored — closing used to flip a
    status and nothing more, so nobody ever found out whether the period
    worked. Freezing it also means the answer cannot drift later as unrelated
    work is scored.
    """
    existing = buddy_cycles_store.get(cycle_id)
    if existing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="cycle_not_found",
        )

    try:
        summary = growth.build_summary(existing, existing.mentee_id)
    except Exception as exc:  # never block a close on a reporting failure
        logger.warning(
            "buddy_cycle_summary_failed cycle=%s err=%s", cycle_id, type(exc).__name__
        )
        summary = None

    cycle = buddy_cycles_store.close(cycle_id, summary=summary)
    if cycle is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="cycle_not_found",
        )
    logger.info(
        "buddy_cycle_closed cycle=%s by=%s verdict=%s",
        cycle_id,
        current_user.uid,
        summary.verdict if summary else "none",
    )
    return cycle


@router.post("/admin/pairs/{pair_id}/end", response_model=BuddyPair)
async def end_pair(
    pair_id: str,
    current_user: User = Depends(require_teacher),
) -> BuddyPair:
    """End a pairing. History is kept; the conversation becomes read-only."""
    pair = buddy_pairs_store.end(pair_id)
    if pair is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="pair_not_found",
        )
    logger.info("buddy_pair_ended pair=%s by=%s", pair_id, current_user.uid)
    return pair


# ---------------------------------------------------------------------------
# Concerns — either side saying the pairing is not working
# ---------------------------------------------------------------------------
#
# Until this existed, the only way a bad pairing surfaced was `health` going
# quiet or stalled at 7 and 14 days. That signal cannot tell a wrong pairing
# from exam week, and it arrives two weeks late either way. A raised hand is
# the one thing the platform cannot infer from activity, so it has to be asked
# for directly.
#
# Everything here is teacher-visible only. `get_my_concern` returns the
# CALLER'S OWN concern and nothing else; there is deliberately no route by
# which a participant can read their partner's. See `BuddyConcern`.

VALID_CONCERN_REASONS = ("mismatch", "unresponsive", "schedule", "uncomfortable", "other")

MAX_CONCERN_DETAIL_CHARS = 1000


@router.post("/pairs/{pair_id}/concern", response_model=BuddyConcern)
async def raise_concern(
    pair_id: str,
    body: RaiseConcernRequest,
    current_user: User = Depends(require_user),
) -> BuddyConcern:
    """Flag that this pairing is not working. Participants only, teacher-visible.

    A teacher is refused rather than silently allowed: they already have the
    admin queue, and a concern raised by the person who created the pairing
    would corrupt the mentor/mentee split that makes the queue readable.
    """
    pair = _require_membership(pair_id, current_user)

    if not pair.involves(current_user.uid):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="not_a_participant",
        )

    reason = (body.reason or "other").strip().lower()  # a closed vocabulary
    if reason not in VALID_CONCERN_REASONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid_reason",
        )

    detail = (body.detail or "").strip()
    if len(detail) > MAX_CONCERN_DETAIL_CHARS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="detail_too_long",
        )

    role = "mentor" if pair.mentor_id == current_user.uid else "mentee"

    try:
        return buddy_concerns_store.raise_concern(
            pair_id=pair_id,
            raised_by_id=current_user.uid,
            role=role,
            reason=reason,
            detail=detail,
        )
    except ValueError:
        # Already flagged and not yet dealt with. Saying so is more useful than
        # silently making a second identical row.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="concern_already_open",
        )


@router.get("/pairs/{pair_id}/concern", response_model=MyConcernResponse)
async def get_my_concern(
    pair_id: str,
    current_user: User = Depends(require_user),
) -> MyConcernResponse:
    """The caller's own open concern on this pair, so the UI can say it was sent.

    Returns the caller's row only. A participant asking about a pair never
    learns whether the other side has flagged anything.
    """
    _require_membership(pair_id, current_user)
    return MyConcernResponse(
        concern=buddy_concerns_store.open_for(pair_id, current_user.uid)
    )


@router.get("/admin/concerns", response_model=ConcernsResponse)
async def list_concerns(
    include_resolved: bool = False,
    _: User = Depends(require_teacher),
) -> ConcernsResponse:
    """The triage queue — open concerns oldest first, since it is a worklist."""
    concerns = (
        buddy_concerns_store.list_all()
        if include_resolved
        else buddy_concerns_store.list_open()
    )
    if include_resolved:
        concerns.sort(key=lambda c: c.raised_at, reverse=True)
    return ConcernsResponse(
        concerns=concerns,
        total=len(concerns),
        people=identity.resolve_many([c.raised_by_id for c in concerns]),
    )


@router.post("/admin/concerns/{concern_id}/resolve", response_model=BuddyConcern)
async def resolve_concern(
    concern_id: str,
    body: ResolveConcernRequest,
    current_user: User = Depends(require_teacher),
) -> BuddyConcern:
    """Close a concern with a note on what was actually done about it.

    The note is the point. "Resolved" with no record of the action reduces to
    a teacher having clicked something, which is what the flag existed to
    replace.
    """
    concern = buddy_concerns_store.get(concern_id)
    if concern is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="concern_not_found",
        )
    if concern.status == "resolved":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="already_resolved",
        )

    resolved = buddy_concerns_store.resolve(
        concern_id,
        resolved_by_id=current_user.uid,
        resolution=body.resolution or "",
    )
    if resolved is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="concern_not_found",
        )
    return resolved


# ---------------------------------------------------------------------------
# Nudges the student themselves receives
# ---------------------------------------------------------------------------
#
# `digest` has always known who needs chasing and why. Until this endpoint the
# whole worklist went to one place — a teacher's admin panel — so the two
# people who could actually restart a stalled pairing were the last to hear
# that it had stalled, and the inbox nudge on `/me` only reached whoever
# already opened the buddy tab. A pairing that has stopped is precisely one
# nobody is opening.
#
# There is still no mail transport and no scheduler here. This is not a
# substitute for one: it is the same derived worklist, addressed, so the app
# can hand a person their own share of it the moment they next look anywhere.


@router.get("/my-nudges", response_model=MyNudgesResponse)
async def my_nudges(current_user: User = Depends(require_user)) -> MyNudgesResponse:
    """The caller's own nudges — theirs only, whatever role they hold.

    A teacher gets the pairings they created that need an administrative move
    (no cycle, cycle overdue); a student gets their own pairings. Nobody sees
    anyone else's, which is what makes this safe to show outside the admin
    area.
    """
    try:
        nudges = digest.for_recipient(current_user.uid)
    except Exception as exc:  # a nudge failure must never break the app shell
        logger.warning("buddy_my_nudges_failed err=%s", type(exc).__name__)
        return MyNudgesResponse()
    return MyNudgesResponse(nudges=nudges, total=len(nudges))


@router.get("/badge", response_model=BuddyBadge)
async def buddy_badge(current_user: User = Depends(require_user)) -> BuddyBadge:
    """The counts the main menu needs, and nothing else.

    Deliberately not `/me`: that builds every conversation preview, which
    means reading every message in every pairing, and the menu renders on
    every navigation. This answers the same question in one pass over the
    message log.

    A voice note from your mentor used to be invisible until you thought to go
    and look for it, which in an asynchronous programme is the difference
    between a reply tomorrow and no reply at all.
    """
    pairs = buddy_pairs_store.list_for_user(current_user.uid)
    active = [p for p in pairs if p.status == "active"]

    try:
        unread = buddy_messages_store.unread_total(
            current_user.uid, {p.pair_id for p in pairs}
        )
    except Exception as exc:
        logger.warning("buddy_badge_unread_failed err=%s", type(exc).__name__)
        unread = 0

    try:
        nudges = len(digest.for_recipient(current_user.uid))
    except Exception as exc:
        logger.warning("buddy_badge_nudges_failed err=%s", type(exc).__name__)
        nudges = 0

    can_request = (
        not current_user.is_teacher
        and not active
        and buddy_requests_store.open_for(current_user.uid) is None
    )

    return BuddyBadge(
        unread=unread,
        nudges=nudges,
        has_pairing=bool(active),
        can_request=can_request,
    )


# ---------------------------------------------------------------------------
# Asking for a mentor
# ---------------------------------------------------------------------------
#
# Everything else in this programme is teacher-push, and that is the right
# default: the student who most needs coaching is often the last to ask for
# it. But it left no way in at all for the student who does ask. Their only
# route was to be noticed, and the ranking that does the noticing is built
# from scored work — so a student who has done little is invisible to exactly
# the mechanism meant to help them do more.


@router.post("/request", response_model=BuddyRequest)
async def request_buddy(
    body: RequestBuddyRequest,
    current_user: User = Depends(require_user),
) -> BuddyRequest:
    """Ask to be given a mentor.

    Refused for someone who already has an active pairing: the thing to do
    with a pairing that is not working is raise a concern, which a teacher
    triages against the pairing itself. Silently queueing them for a second
    mentor would hide that.
    """
    if current_user.is_teacher:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="teachers_do_not_request_mentors",
        )

    active = [
        p
        for p in buddy_pairs_store.list_for_user(current_user.uid)
        if p.status == "active"
    ]
    if active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="already_paired",
        )

    try:
        request = buddy_requests_store.create(
            user_id=current_user.uid,
            note=body.note or "",
            focus_area=body.focus_area,
        )
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="request_already_open",
        )

    logger.info("buddy_request_raised user=%s", current_user.uid)
    return request


@router.get("/my-request", response_model=MyRequestResponse)
async def my_request(
    current_user: User = Depends(require_user),
) -> MyRequestResponse:
    """The caller's own outstanding request, and whether they may raise one.

    The reason is returned rather than left implicit so the UI can say why the
    button is not there. A disabled control with no explanation reads as the
    feature being broken.
    """
    if current_user.is_teacher:
        return MyRequestResponse(can_request=False, reason="teacher")

    pending = buddy_requests_store.open_for(current_user.uid)
    if pending is not None:
        return MyRequestResponse(
            request=pending, can_request=False, reason="already_requested"
        )

    active = [
        p
        for p in buddy_pairs_store.list_for_user(current_user.uid)
        if p.status == "active"
    ]
    if active:
        return MyRequestResponse(can_request=False, reason="already_paired")

    return MyRequestResponse(can_request=True)


@router.get("/admin/requests", response_model=RequestsResponse)
async def list_requests(
    include_resolved: bool = False,
    _: User = Depends(require_teacher),
) -> RequestsResponse:
    """Students waiting for a mentor, longest wait first — it is a queue."""
    requests = (
        buddy_requests_store.list_all()
        if include_resolved
        else buddy_requests_store.list_open()
    )
    if include_resolved:
        requests.sort(key=lambda r: r.created_at, reverse=True)
    return RequestsResponse(
        requests=requests,
        total=len(requests),
        people=identity.resolve_many([r.user_id for r in requests]),
    )


@router.post("/admin/requests/{request_id}/decline", response_model=BuddyRequest)
async def decline_request(
    request_id: str,
    body: DeclineRequestRequest,
    current_user: User = Depends(require_teacher),
) -> BuddyRequest:
    """Close a request without pairing anyone.

    Kept as a row rather than deleted, and it is not a rejection of the
    student: the ordinary case is that there is no free approved mentor this
    term. The count of these is the honest measure of the programme's reach,
    and deleting them would make an unserved cohort look like an empty queue.

    A request answered by actually pairing the student closes itself — see
    `create_pair`.
    """
    existing = buddy_requests_store.get(request_id)
    if existing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="request_not_found",
        )
    if existing.status != "open":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="request_already_resolved",
        )

    declined = buddy_requests_store.resolve(
        request_id, "declined", resolved_by_id=current_user.uid
    )
    if declined is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="request_not_found",
        )
    logger.info(
        "buddy_request_declined request=%s by=%s", request_id, current_user.uid
    )
    return declined


# ---------------------------------------------------------------------------
# Teacher — the pairing picker
# ---------------------------------------------------------------------------


# Which axis a mentor is picked to fix, mapped to the axis that shows whether
# they can. Same keys `growth` uses, so the two screens agree on what a
# "weak axis" is.
_AXIS_LABELS = {
    "content": "Content",
    "pronunciation": "Pronunciation",
    "live_speaking": "Live speaking",
}

# How many mentees one mentor may hold before the picker stops suggesting
# them. Not enforced — a teacher may still pair over it — but a mentor with
# four mentees is a mentor with four unanswered voice notes.
SUGGEST_MENTEE_CAP = 2


def _weakest_axis(ranking) -> tuple[Optional[str], Optional[float]]:
    """The lowest measured axis for a student, or (None, None) if unmeasured."""
    measured = [
        (key, value)
        for key, value in (
            ("content", ranking.content_avg),
            ("pronunciation", ranking.pronunciation_avg),
            ("live_speaking", ranking.live_speaking_avg),
        )
        if value is not None
    ]
    if not measured:
        return None, None
    key, value = min(measured, key=lambda item: item[1])
    return key, value


def _axis_value(ranking, key: Optional[str]) -> Optional[float]:
    if key is None:
        return None
    return {
        "content": ranking.content_avg,
        "pronunciation": ranking.pronunciation_avg,
        "live_speaking": ranking.live_speaking_avg,
    }.get(key)


@router.get("/admin/students", response_model=StudentsResponse)
async def list_students(
    unpaired_only: bool = False,
    _: User = Depends(require_teacher),
) -> StudentsResponse:
    """The cohort, with who mentors whom and who nobody does.

    Pairing was two email addresses typed into a form, which meant a teacher
    could only pair a student whose address they already had in mind, and had
    no way at all to see who was being left out. The list of students with no
    mentor is the one this screen exists for; everything else on the row is
    what a teacher would otherwise have to open three panels to find.

    `suggestions` proposes a mentor per unpaired student by matching the
    mentee's weakest measured axis against the approved mentors' strength on
    that same axis. It is a shortlist, never an action — the pairing itself
    stays a teacher's decision, because the thing that decides whether two
    students work together is not in any of this data.
    """
    ranking = {r.user_id: r for r in service.rank_speakers()}
    active_pairs = buddy_pairs_store.list_active()
    mentor_by_mentee = {p.mentee_id: p.mentor_id for p in active_pairs}
    people = identity.resolve_many(
        [p.mentor_id for p in active_pairs] + [p.mentee_id for p in active_pairs]
    )
    open_requests = {r.user_id: r for r in buddy_requests_store.list_open()}

    rows: list[StudentRow] = []
    for person in identity.students():
        rank = ranking.get(person.user_id)
        mentor_id = mentor_by_mentee.get(person.user_id)
        weak_key, weak_value = _weakest_axis(rank) if rank else (None, None)

        rows.append(
            StudentRow(
                person=person,
                has_mentor=mentor_id is not None,
                mentor=(
                    people.get(mentor_id) or Person(user_id=mentor_id)
                    if mentor_id
                    else None
                ),
                speaking_score=rank.speaking_score if rank else None,
                sample_size=rank.sample_size if rank else 0,
                weakest_axis=_AXIS_LABELS.get(weak_key) if weak_key else None,
                weakest_score=weak_value,
                is_approved_mentor=mentors_store.is_approved(person.user_id),
                active_mentees=sum(
                    1 for p in active_pairs if p.mentor_id == person.user_id
                ),
                open_request=open_requests.get(person.user_id),
            )
        )

    # Students who asked first, then everyone else without a mentor, then the
    # rest — the order a teacher works down when they sit down to pair people.
    rows.sort(
        key=lambda r: (
            r.open_request is None,
            r.has_mentor,
            -(r.speaking_score or 0.0),
        )
    )

    unpaired = [r for r in rows if not r.has_mentor]
    visible = unpaired if unpaired_only else rows

    # --- suggested pairings ---
    mentors = [
        r
        for r in rows
        if r.is_approved_mentor and r.active_mentees < SUGGEST_MENTEE_CAP
    ]
    suggestions: list[SuggestedPairing] = []
    taken: dict[str, int] = {}

    for row in unpaired:
        rank = ranking.get(row.person.user_id)
        weak_key, _ = _weakest_axis(rank) if rank else (None, None)

        best = None
        best_score = None
        for mentor in mentors:
            if mentor.person.user_id == row.person.user_id:
                continue
            held = mentor.active_mentees + taken.get(mentor.person.user_id, 0)
            if held >= SUGGEST_MENTEE_CAP:
                continue
            mentor_rank = ranking.get(mentor.person.user_id)
            if mentor_rank is None:
                continue
            # Score on the axis the mentee is weakest at; with nothing
            # measured about the mentee, fall back to overall speaking so a
            # brand-new student is still offered somebody.
            score = _axis_value(mentor_rank, weak_key)
            if score is None:
                score = mentor_rank.speaking_score
            if best_score is None or score > best_score:
                best, best_score = mentor, score

        if best is None:
            continue
        taken[best.person.user_id] = taken.get(best.person.user_id, 0) + 1
        suggestions.append(
            SuggestedPairing(
                mentee=row.person,
                mentor=best.person,
                reason=(
                    f"Strongest available on {_AXIS_LABELS[weak_key].lower()}"
                    if weak_key
                    else "Strongest available speaker"
                ),
                mentee_weakest_axis=row.weakest_axis,
                mentor_axis_score=best_score,
                mentor_active_mentees=best.active_mentees,
            )
        )

    return StudentsResponse(
        students=visible,
        total=len(visible),
        unpaired=len(unpaired),
        suggestions=suggestions,
    )


# ---------------------------------------------------------------------------
# Teacher — closing cycles that have run out
# ---------------------------------------------------------------------------


@router.post("/admin/cycles/sweep", response_model=SweepCyclesResponse)
async def sweep_cycles(
    current_user: User = Depends(require_teacher),
) -> SweepCyclesResponse:
    """Close every cycle that is past its end date, freezing each summary.

    `ends_at` was written when a cycle opened and then only ever displayed.
    Nothing acted on it, so a cycle ran past its end indefinitely: the summary
    that closing computes was never written, the verdict never reached the
    pair, and the `improved` verdict that feeds the growth path back into
    mentor selection never fired. A period that cannot end cannot conclude
    anything, which quietly made the whole cycle model unmeasurable.

    A teacher's action rather than a background job, because this codebase has
    no scheduler and because closing a cycle is a judgement — the digest
    surfaces the overdue ones, and this is the one click that clears them.
    Each summary is computed exactly as `close_cycle` computes it.
    """
    expired = buddy_cycles_store.list_expired()
    closed: list[BuddyCycle] = []

    for cycle in expired:
        try:
            summary = growth.build_summary(cycle, cycle.mentee_id)
        except Exception as exc:  # never block the sweep on one bad report
            logger.warning(
                "buddy_sweep_summary_failed cycle=%s err=%s",
                cycle.cycle_id,
                type(exc).__name__,
            )
            summary = None

        result = buddy_cycles_store.close(cycle.cycle_id, summary=summary)
        if result is not None:
            closed.append(result)
            logger.info(
                "buddy_cycle_swept cycle=%s by=%s verdict=%s",
                cycle.cycle_id,
                current_user.uid,
                summary.verdict if summary else "none",
            )

    return SweepCyclesResponse(closed=closed, total=len(closed))


# ---------------------------------------------------------------------------
# Live sessions — a room a pair can actually speak in
# ---------------------------------------------------------------------------
#
# `live_call` was a mode with no call behind it. A pair picked it, met on
# whatever they use to talk to each other, and came back to tick a box — so
# the only record of the practice was their own word for it, and the cycle
# report counted nothing.
#
# A debate room is exactly two participants, which is exactly a buddy pair, so
# the session opens one of the platform's own rooms with the motion the
# session already points at. What happens in it is scored by the debate
# pipeline and written to the debate store, which is where
# `growth._live_events` reads — so the practice lands in the cycle without
# either of them reporting it.
#
# GD is deliberately not offered: a GD room needs five to start, and a pair
# cannot fill one. Offering a room that can never begin would be worse than
# offering none.

ROOMABLE_PROMPT_KINDS = ("debate",)


@router.post("/sessions/{session_id}/room", response_model=OpenRoomResponse)
async def open_session_room(
    session_id: str,
    current_user: User = Depends(require_user),
) -> OpenRoomResponse:
    """Open (or rejoin) the live room for a planned session.

    Whoever calls first creates the room; the other side calls the same
    endpoint and is handed the code that is already there. Rooms are held in
    process memory and swept when they go stale, so a code whose room no
    longer exists is replaced rather than returned — a pair stranded with a
    dead code has no way to tell that from the feature being broken.
    """
    from app.debate.room_manager import debate_room_manager

    session = _session_for_member(session_id, current_user)
    pair = _require_active_membership(session.pair_id, current_user)

    if session.status != "planned":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="session_already_resolved",
        )
    if session.mode != "live_call":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="not_a_live_session",
        )
    if session.prompt_kind not in ROOMABLE_PROMPT_KINDS or not session.prompt_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="live_room_needs_a_debate_prompt",
        )

    # An existing room, if it is still alive.
    if session.room_code and debate_room_manager.get_state(session.room_code):
        return OpenRoomResponse(
            session=session,
            room_kind="debate",
            room_code=session.room_code,
            created=False,
        )

    try:
        room = await debate_room_manager.create_room(
            current_user, motion_id=session.prompt_id
        )
    except HTTPException:
        # A motion that has since been deleted from the catalog reads as a
        # 4xx from the debate side; let it through unchanged.
        raise
    except Exception as exc:
        logger.warning(
            "buddy_session_room_failed session=%s err=%s",
            session_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="room_unavailable",
        )

    updated = buddy_sessions_store.attach_room(session_id, "debate", room.code)
    logger.info(
        "buddy_session_room session=%s pair=%s code=%s by=%s",
        session_id,
        pair.pair_id,
        room.code,
        current_user.uid,
    )
    return OpenRoomResponse(
        session=updated or session,
        room_kind="debate",
        room_code=room.code,
        created=True,
    )
