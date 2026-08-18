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
from app.buddy import service
from app.buddy.schemas import ConversationSummary
from app.buddy.schemas import CreatePairRequest
from app.buddy.schemas import MarkReadResponse
from app.buddy.schemas import MentorCandidatesResponse
from app.buddy.schemas import MentorDecisionRequest
from app.buddy.schemas import MentorsResponse
from app.buddy.schemas import MessagesResponse
from app.buddy.schemas import MyBuddiesResponse
from app.buddy.schemas import PairsResponse
from app.buddy.schemas import SendMessageRequest
from app.storage import users_store
from app.storage.buddy import BuddyMessage
from app.storage.buddy import BuddyPair
from app.storage.buddy import buddy_messages_store
from app.storage.buddy import buddy_pairs_store
from app.storage.buddy import mentors_store

logger = logging.getLogger("buddy.routes")

router = APIRouter(prefix="/buddy", tags=["buddy"])

# Voice notes are short by design — a spoken reply, not a recorded lecture.
# Well under the interview cap so a runaway recording fails fast.
MAX_VOICE_NOTE_BYTES = 10 * 1024 * 1024

MAX_MESSAGE_CHARS = 2000


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


@router.get("/me", response_model=MyBuddiesResponse)
async def my_buddies(current_user: User = Depends(require_user)) -> MyBuddiesResponse:
    """Every buddy conversation the current user belongs to, newest activity first."""
    conversations: list[ConversationSummary] = []

    for pair in buddy_pairs_store.list_for_user(current_user.email):
        partner_email = pair.partner_of(current_user.email)
        if partner_email is None:
            continue
        messages = buddy_messages_store.list_for_pair(pair.pair_id)
        last = messages[-1] if messages else None
        is_mentor = pair.mentor_email.lower() == current_user.email.lower()
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


@router.get("/admin/pairs", response_model=PairsResponse)
async def list_pairs(_: User = Depends(require_teacher)) -> PairsResponse:
    """Every buddy pairing, active or ended."""
    pairs = buddy_pairs_store.list_all()
    pairs.sort(key=lambda p: p.created_at, reverse=True)
    return PairsResponse(pairs=pairs, total=len(pairs))


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
    return pair


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
