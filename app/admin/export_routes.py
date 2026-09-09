"""CSV export routes for admin analytics."""

from __future__ import annotations

import csv
import io
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Response

from app.auth import User, require_teacher
from app.storage import submissions_store, users_store
from app.storage import debates as debates_store
from app.storage import debate_turns as debate_turns_store
from app.storage import gd_sessions as gd_sessions_store

logger = logging.getLogger("admin.export")

router = APIRouter(prefix="/admin/export", tags=["admin-export"])


def _csv_response(rows: list[list[str]], filename: str) -> Response:
    """Convert list of rows to CSV response."""
    output = io.StringIO()
    writer = csv.writer(output)
    for row in rows:
        writer.writerow(row)
    csv_content = output.getvalue()
    output.close()
    
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.get("/students.csv")
async def export_students_csv(
    current_user: User = Depends(require_teacher),
) -> Response:
    """Export all students with their statistics."""
    del current_user
    
    student_users = users_store.list_by_role("student")
    all_submissions = submissions_store.list_all()
    
    rows = [
        [
            "Email",
            "Display Name",
            "First Seen",
            "Last Seen",
            "Total Submissions",
            "Reviewed",
            "Avg Score",
        ]
    ]
    
    for user in student_users:
        subs = [s for s in all_submissions if s.student_email.lower() == user.email.lower()]
        reviewed = [s for s in subs if s.status == "reviewed" and s.combined_score is not None]
        avg = (
            round(sum(s.combined_score or 0 for s in reviewed) / len(reviewed))
            if reviewed
            else "N/A"
        )
        
        rows.append([
            user.email,
            user.display_name or "",
            datetime.fromtimestamp(user.first_seen_at).strftime("%Y-%m-%d %H:%M") if user.first_seen_at else "",
            datetime.fromtimestamp(user.last_seen_at).strftime("%Y-%m-%d %H:%M") if user.last_seen_at else "",
            str(len(subs)),
            str(len(reviewed)),
            str(avg),
        ])
    
    filename = f"students_{datetime.now().strftime('%Y%m%d')}.csv"
    return _csv_response(rows, filename)


@router.get("/submissions.csv")
async def export_submissions_csv(
    current_user: User = Depends(require_teacher),
) -> Response:
    """Export all interview submissions."""
    del current_user
    
    all_submissions = submissions_store.list_all()
    
    rows = [
        [
            "Submission ID",
            "Student Email",
            "Student Name",
            "Question ID",
            "Question Prompt",
            "Category",
            "Status",
            "Gesture Score",
            "Teacher Score",
            "Combined Score",
            "Submitted At",
            "Reviewed At",
        ]
    ]
    
    for s in all_submissions:
        rows.append([
            s.submission_id,
            s.student_email,
            s.student_name or "",
            s.question_id,
            s.question_prompt[:100],  # Truncate long prompts
            s.question_category,
            s.status,
            str(s.gesture_score) if s.gesture_score is not None else "",
            str(s.teacher_score) if s.teacher_score is not None else "",
            str(s.combined_score) if s.combined_score is not None else "",
            datetime.fromtimestamp(s.submitted_at).strftime("%Y-%m-%d %H:%M") if s.submitted_at else "",
            datetime.fromtimestamp(s.reviewed_at).strftime("%Y-%m-%d %H:%M") if s.reviewed_at else "",
        ])
    
    filename = f"submissions_{datetime.now().strftime('%Y%m%d')}.csv"
    return _csv_response(rows, filename)


@router.get("/debates.csv")
async def export_debates_csv(
    current_user: User = Depends(require_teacher),
) -> Response:
    """Export all completed debates."""
    del current_user
    
    all_debates = debates_store.list_all()
    
    rows = [
        [
            "Debate ID",
            "Code",
            "Motion",
            "Participant Count",
            "Winner",
            "Created At",
            "Completed At",
        ]
    ]
    
    for d in all_debates:
        winner_name = ""
        if d.winner_participant_id:
            for p in d.participants:
                if isinstance(p, dict) and p.get("participant_id") == d.winner_participant_id:
                    winner_name = p.get("display_name", "")
                    break
        
        rows.append([
            d.debate_id,
            d.code,
            d.motion_title,
            str(len(d.participants)),
            winner_name,
            datetime.fromtimestamp(d.created_at).strftime("%Y-%m-%d %H:%M") if d.created_at else "",
            datetime.fromtimestamp(d.completed_at).strftime("%Y-%m-%d %H:%M") if d.completed_at else "",
        ])
    
    filename = f"debates_{datetime.now().strftime('%Y%m%d')}.csv"
    return _csv_response(rows, filename)


@router.get("/gd_sessions.csv")
async def export_gd_sessions_csv(
    current_user: User = Depends(require_teacher),
) -> Response:
    """Export all GD sessions with participant scores."""
    del current_user
    
    from pathlib import Path
    from app.storage._jsonl import read_jsonl
    from app.gd.schemas import GDSessionRecord
    
    rows = [
        [
            "Session ID",
            "Code",
            "Topic",
            "Participant",
            "Total Score",
            "Content Quality",
            "Communication",
            "Participation",
            "Listening",
            "Leadership",
            "Rank",
            "Speech Count",
            "Speak Time (s)",
            "Interruptions",
            "Completed At",
        ]
    ]
    
    all_sessions = []
    for row in read_jsonl(Path("outputs/gd_sessions.jsonl")):
        try:
            all_sessions.append(GDSessionRecord.model_validate(row))
        except Exception:
            continue
    
    for session in all_sessions:
        for score in session.scores:
            rows.append([
                session.session_id,
                session.code,
                session.topic_title,
                score.display_name,
                str(score.total_score),
                str(score.content_quality),
                str(score.communication),
                str(score.participation),
                str(score.listening),
                str(score.leadership),
                str(score.rank),
                str(score.speech_count),
                str(round(score.total_speak_seconds, 1)),
                str(score.interruption_count),
                datetime.fromtimestamp(session.completed_at).strftime("%Y-%m-%d %H:%M") if session.completed_at else "",
            ])
    
    filename = f"gd_sessions_{datetime.now().strftime('%Y%m%d')}.csv"
    return _csv_response(rows, filename)


@router.get("/analytics_summary.csv")
async def export_analytics_summary(
    current_user: User = Depends(require_teacher),
) -> Response:
    """Export overall analytics summary."""
    del current_user
    
    from pathlib import Path
    from app.storage._jsonl import read_jsonl
    
    students = users_store.list_by_role("student")
    teachers = users_store.list_by_role("teacher")
    all_submissions = submissions_store.list_all()
    reviewed = [s for s in all_submissions if s.status == "reviewed"]
    all_debates = debates_store.list_all()
    
    gd_count = len(read_jsonl(Path("outputs/gd_sessions.jsonl")))
    
    rows = [
        ["Metric", "Value"],
        ["Report Generated", datetime.now().strftime("%Y-%m-%d %H:%M:%S")],
        ["Total Students", str(len(students))],
        ["Total Teachers", str(len(teachers))],
        ["Total Interview Submissions", str(len(all_submissions))],
        ["Interviews Reviewed", str(len(reviewed))],
        ["Interviews Pending", str(len(all_submissions) - len(reviewed))],
        ["Total Debates Completed", str(len(all_debates))],
        ["Total GD Sessions Completed", str(gd_count)],
    ]
    
    if reviewed:
        avg_score = sum(s.combined_score or 0 for s in reviewed) / len(reviewed)
        rows.append(["Average Interview Score", f"{avg_score:.1f}"])
    
    filename = f"analytics_summary_{datetime.now().strftime('%Y%m%d')}.csv"
    return _csv_response(rows, filename)


# ---------------------------------------------------------------------------
# Buddy programme
# ---------------------------------------------------------------------------
#
# None of this could leave the app before, so a programme with a year of
# pairings behind it still could not put a single number in front of a
# department review without someone reading panels off a screen.
#
# Both exports resolve `user_id` to a name and address at write time — the
# stored rows carry ids only (see `app.buddy.identity`), and a spreadsheet of
# opaque ids answers nobody's question.


def _buddy_people() -> dict:
    """Every known user, keyed by id, for labelling exported rows."""
    return {u.firebase_uid: u for u in users_store.list_all()}


def _label(people: dict, user_id: str) -> tuple[str, str]:
    """(name, email) for an id, blank when the users log has never seen it."""
    record = people.get(user_id)
    if record is None:
        return "", ""
    return record.display_name or "", record.email or ""


@router.get("/buddy_pairs.csv")
async def export_buddy_pairs_csv(
    current_user: User = Depends(require_teacher),
) -> Response:
    """One row per buddy pairing: who, how it is going, and how it came out."""
    del current_user

    from app.buddy import health as buddy_health
    from app.storage.buddy import buddy_cycles_store
    from app.storage.buddy import buddy_pairs_store

    people = _buddy_people()
    pairs = buddy_pairs_store.list_all()
    pairs.sort(key=lambda p: p.created_at, reverse=True)

    try:
        index = buddy_health.build_index(pairs)
    except Exception as exc:  # an export must not fail on a derived column
        logger.warning("buddy_export_health_failed err=%s", type(exc).__name__)
        index = {}

    cycles_by_pair: dict[str, list] = {}
    for cycle in buddy_cycles_store.list_all():
        cycles_by_pair.setdefault(cycle.pair_id, []).append(cycle)

    rows = [
        [
            "Pair ID",
            "Mentor",
            "Mentor Email",
            "Mentee",
            "Mentee Email",
            "Status",
            "Created",
            "Ended",
            "Health",
            "Days Quiet",
            "Messages",
            "Sessions Completed",
            "Sessions Missed",
            "Cycles",
            "Cycles Closed",
            "Latest Verdict",
        ]
    ]

    for pair in pairs:
        mentor_name, mentor_email = _label(people, pair.mentor_id)
        mentee_name, mentee_email = _label(people, pair.mentee_id)
        entry = index.get(pair.pair_id)
        cycles = cycles_by_pair.get(pair.pair_id, [])
        closed = [c for c in cycles if c.status == "closed" and c.summary is not None]
        closed.sort(key=lambda c: c.closed_at or "", reverse=True)

        rows.append([
            pair.pair_id,
            mentor_name,
            mentor_email,
            mentee_name,
            mentee_email,
            pair.status,
            pair.created_at[:10],
            (pair.ended_at or "")[:10],
            entry.state if entry else "",
            str(entry.days_quiet) if entry and entry.days_quiet is not None else "",
            str(entry.message_count) if entry else "",
            str(entry.sessions.completed) if entry else "",
            str(entry.sessions.missed) if entry else "",
            str(len(cycles)),
            str(len(closed)),
            # The most recent frozen verdict. Blank rather than "held" when
            # nothing has closed: a pairing that has not finished a period has
            # no result, and printing one would invent it.
            closed[0].summary.verdict if closed else "",
        ])

    filename = f"buddy_pairs_{datetime.now().strftime('%Y%m%d')}.csv"
    return _csv_response(rows, filename)


@router.get("/buddy_sessions.csv")
async def export_buddy_sessions_csv(
    current_user: User = Depends(require_teacher),
) -> Response:
    """One row per planned session — the programme's practice record.

    Includes sessions that were missed and sessions still pending, because a
    keep rate computed from completed sessions alone is not a keep rate.
    """
    del current_user

    from app.storage.buddy import buddy_cycles_store
    from app.storage.buddy import buddy_pairs_store
    from app.storage.buddy import buddy_sessions_store

    people = _buddy_people()
    pairs = {p.pair_id: p for p in buddy_pairs_store.list_all()}
    cycles = {c.cycle_id: c for c in buddy_cycles_store.list_all()}

    sessions = buddy_sessions_store.list_all()
    sessions.sort(key=lambda s: s.scheduled_at, reverse=True)

    rows = [
        [
            "Session ID",
            "Pair ID",
            "Mentor",
            "Mentee",
            "Mentee Email",
            "Cycle Goal",
            "Scheduled",
            "Status",
            "Mode",
            "Practice Kind",
            "Practice Topic",
            "Room Code",
            "Duration (min)",
            "Mentee Rating",
            "Rating Reasons",
        ]
    ]

    for session in sessions:
        pair = pairs.get(session.pair_id)
        cycle = cycles.get(session.cycle_id)
        mentor_name, _ = _label(people, pair.mentor_id) if pair else ("", "")
        mentee_name, mentee_email = _label(people, pair.mentee_id) if pair else ("", "")

        rows.append([
            session.session_id,
            session.pair_id,
            mentor_name,
            mentee_name,
            mentee_email,
            cycle.goal if cycle else "",
            session.scheduled_at[:16],
            session.status,
            session.mode,
            session.prompt_kind or "",
            session.prompt_title or session.topic,
            session.room_code or "",
            str(session.duration_minutes) if session.duration_minutes else "",
            str(session.mentee_rating) if session.mentee_rating else "",
            " ".join(session.mentee_rating_aspects),
        ])

    filename = f"buddy_sessions_{datetime.now().strftime('%Y%m%d')}.csv"
    return _csv_response(rows, filename)
