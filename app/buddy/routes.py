"""Buddy mentorship endpoints — student conversations and teacher administration.

Mentors are students who already demonstrate strong speaking scores; the system
suggests them and a teacher approves. An approved mentor is paired with a mentee
by a teacher, and the pair then talks 1:1 over text and asynchronous voice notes.

Access rule: a student may only touch a pair they belong to. Teachers may read
any pair, since they created the pairing and are responsible for it.
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
from app.buddy import practice
from app.buddy import programme
from app.buddy import service
from app.buddy.growth import CycleReport
from app.buddy.schemas import CompleteSessionRequest
from app.buddy.schemas import ConcernsResponse
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
from app.buddy.schemas import PracticePromptsResponse
from app.buddy.schemas import RaiseConcernRequest
from app.buddy.schemas import RateSessionRequest
from app.buddy.schemas import ResolveConcernRequest
from app.buddy.schemas import MyBuddiesResponse
from app.buddy.schemas import PairsResponse
from app.buddy.schemas import SendMessageRequest
from app.storage import users_store
from app.storage.buddy import BuddyConcern
from app.storage.buddy import BuddyCycle
from app.storage.buddy import BuddyMessage
from app.storage.buddy import BuddyPair
from app.storage.buddy import BuddySession
from app.storage.buddy import buddy_concerns_store
from app.storage.buddy import buddy_cycles_store
from app.storage.buddy import buddy_messages_store
from app.storage.buddy import buddy_pairs_store
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
    if not (user.is_teacher or pair.involves(user.email)):
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
    if not pair.involves(user.email):
        # A teacher may read a pair but is not a participant in it.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="not_a_participant",
        )
    return pair


def _display_name(email: str) -> str | None:
    record = users_store.get_by_email(email)
    return record.display_name if record else None


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

    my_pairs = buddy_pairs_store.list_for_user(current_user.email)
    # One pass for the whole inbox rather than per conversation.
    health_index = health.build_index(my_pairs)

    for pair in my_pairs:
        partner_email = pair.partner_of(current_user.email)
        if partner_email is None:
            continue
        messages = buddy_messages_store.list_for_pair(pair.pair_id)
        last = messages[-1] if messages else None
        is_mentor = pair.mentor_email.lower() == current_user.email.lower()

        pair_health = health_index.get(pair.pair_id)
        cycle = buddy_cycles_store.active_for_pair(pair.pair_id)
        sessions = (
            buddy_sessions_store.list_for_cycle(cycle.cycle_id) if cycle else []
        )
        upcoming = [s for s in sessions if s.status == "planned"]

        conversations.append(
            ConversationSummary(
                pair_id=pair.pair_id,
                partner_email=partner_email,
                partner_name=(pair.mentee_name if is_mentor else pair.mentor_name)
                or _display_name(partner_email),
                my_role="mentor" if is_mentor else "mentee",
                status=pair.status,
                unread_count=buddy_messages_store.unread_count(
                    pair.pair_id, current_user.email
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
    return MyBuddiesResponse(conversations=conversations, total=len(conversations))


@router.get("/pairs/{pair_id}/messages", response_model=MessagesResponse)
async def get_messages(
    pair_id: str,
    current_user: User = Depends(require_user),
) -> MessagesResponse:
    """Full message history for one conversation."""
    pair = _require_membership(pair_id, current_user)
    partner_email = pair.partner_of(current_user.email) or pair.mentee_email
    # Prefer the name captured on the pair, as the inbox does, so the thread
    # header and the conversation list never disagree about who this is.
    stored_name = (
        pair.mentee_name
        if partner_email.lower() == pair.mentee_email.lower()
        else pair.mentor_name
    )
    messages = buddy_messages_store.list_for_pair(pair_id)
    return MessagesResponse(
        pair_id=pair_id,
        partner_email=partner_email,
        partner_name=stored_name or _display_name(partner_email),
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
        sender_email=current_user.email,
        kind="text",
        body=text[:MAX_MESSAGE_CHARS],
    )
    logger.info(
        "buddy_message pair=%s sender=%s kind=text", pair_id, current_user.email
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
        sender_email=current_user.email,
        kind="voice",
        audio_id=asset.audio_id,
        audio_path=asset.original_path,
    )
    logger.info(
        "buddy_message pair=%s sender=%s kind=voice bytes=%s",
        pair_id,
        current_user.email,
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
    report = growth.build_report(cycle, pair.mentee_email)

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
    marked = buddy_messages_store.mark_read(pair_id, current_user.email)
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
        created_by=current_user.email,
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
        current_user.email,
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
    is_mentor = pair is not None and pair.mentor_email.lower() == current_user.email.lower()

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
        current_user.email,
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
    if pair is None or pair.mentee_email.lower() != current_user.email.lower():
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
    email = current_user.email.lower()
    my_pairs = [p for p in buddy_pairs_store.list_all() if p.mentor_email.lower() == email]
    if not my_pairs:
        return MentorDashboard(is_mentor=mentors_store.is_approved(email))

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
        total_mentees=len({p.mentee_email.lower() for p in my_pairs}),
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


@router.get("/admin/mentors", response_model=MentorsResponse)
async def list_mentors(_: User = Depends(require_teacher)) -> MentorsResponse:
    """Every mentor decision a teacher has recorded."""
    mentors = mentors_store.list_all()
    return MentorsResponse(mentors=mentors, total=len(mentors))


@router.post("/admin/mentors/{email}/decision", response_model=MentorsResponse)
async def decide_mentor(
    email: str,
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
        (r for r in service.rank_speakers() if r.email.lower() == email.lower()),
        None,
    )
    mentors_store.set_status(
        email=email,
        status=body.status,
        decided_by=current_user.email,
        speaking_score=ranking.speaking_score if ranking else 0.0,
        sample_size=ranking.sample_size if ranking else 0,
        name=ranking.name if ranking else _display_name(email),
    )
    logger.info(
        "buddy_mentor_decision email=%s status=%s by=%s",
        email,
        body.status,
        current_user.email,
    )
    mentors = mentors_store.list_all()
    return MentorsResponse(mentors=mentors, total=len(mentors))


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
    )


@router.post("/admin/pairs", response_model=BuddyPair)
async def create_pair(
    body: CreatePairRequest,
    current_user: User = Depends(require_teacher),
) -> BuddyPair:
    """Pair an approved mentor with a mentee."""
    mentor_email = body.mentor_email.strip().lower()
    mentee_email = body.mentee_email.strip().lower()

    if not mentor_email or not mentee_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="both mentor_email and mentee_email are required",
        )
    if mentor_email == mentee_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="a student cannot mentor themselves",
        )
    if not mentors_store.is_approved(mentor_email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="mentor_not_approved",
        )
    if buddy_pairs_store.find_active_between(mentor_email, mentee_email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="pair_already_active",
        )

    pair = buddy_pairs_store.create(
        mentor_email=mentor_email,
        mentee_email=mentee_email,
        created_by=current_user.email,
        mentor_name=_display_name(mentor_email),
        mentee_name=_display_name(mentee_email),
    )
    logger.info(
        "buddy_pair_created mentor=%s mentee=%s by=%s",
        mentor_email,
        mentee_email,
        current_user.email,
    )

    # Pairing without a period is what the cycle work exists to fix, so the
    # first one opens here unless the teacher explicitly asked for none.
    if body.cycle_weeks > 0:
        _open_cycle(
            pair=pair,
            weeks=body.cycle_weeks,
            goal=body.goal,
            focus_area=body.focus_area,
            created_by=current_user.email,
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
    created_by: str,
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
            mentee_email=pair.mentee_email,
            starts_at=now.isoformat(),
            ends_at=(now + timedelta(weeks=weeks)).isoformat(),
            created_by=created_by,
            goal=goal.strip(),
            focus_area=focus_area,
            baseline=growth.baseline_for(pair.mentee_email, now.isoformat()),
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
    return CyclesResponse(cycles=cycles, total=len(cycles))


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
        created_by=current_user.email,
    )
    logger.info(
        "buddy_cycle_opened pair=%s weeks=%s by=%s",
        pair.pair_id,
        body.weeks,
        current_user.email,
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
        summary = growth.build_summary(existing, existing.mentee_email)
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
        current_user.email,
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
    logger.info("buddy_pair_ended pair=%s by=%s", pair_id, current_user.email)
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

    if not pair.involves(current_user.email):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="not_a_participant",
        )

    reason = (body.reason or "other").strip().lower()
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

    role = "mentor" if pair.mentor_email.lower() == current_user.email.lower() else "mentee"

    try:
        return buddy_concerns_store.raise_concern(
            pair_id=pair_id,
            raised_by=current_user.email,
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
        concern=buddy_concerns_store.open_for(pair_id, current_user.email)
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
    return ConcernsResponse(concerns=concerns, total=len(concerns))


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
        resolved_by=current_user.email,
        resolution=body.resolution or "",
    )
    if resolved is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="concern_not_found",
        )
    return resolved
