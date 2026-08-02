"""Tests for the debate live-audio / playback schema additions.

Covers task 1.1's additive schema surface:

- Property 1 (Live audio phase-gating): ``to_public(room).livekit_room`` is
  non-null **iff** ``room.state`` is ``prep`` or ``speaking``.
  Validates: Requirements 1.1.
- Property 8 (PII never leaks): the response/broadcast-safe models
  ``PublicDebateRoom``, ``DebateTurnAudioRef`` and ``DebateDetailResponse``
  never serialize any internal bookkeeping tokens.
  Validates: Requirements 3.1, 4.4.

Framework: ``hypothesis`` (min 100 examples for the property tests) plus a
plain ``pytest`` example test, matching ``tests/test_debate_schemas.py``.
"""

from __future__ import annotations

from hypothesis import HealthCheck
from hypothesis import given
from hypothesis import settings
from hypothesis import strategies as st

from app.debate.schemas import DebateDetailResponse
from app.debate.schemas import DebateRoom
from app.debate.schemas import DebateTurnAudioRef
from app.debate.schemas import Motion
from app.debate.schemas import ParticipantInternal
from app.debate.schemas import PublicDebateRoom
from app.debate.schemas import to_public


# ---------------------------------------------------------------------------
# Shared constants
# ---------------------------------------------------------------------------

ALL_STATES = ("waiting", "prep", "speaking", "scoring", "complete", "abandoned")
ACTIVE_STATES = {"prep", "speaking"}
INACTIVE_STATES = {"waiting", "scoring", "complete", "abandoned"}

# Forbidden internal-bookkeeping tokens that must never appear in any
# response/broadcast projection JSON (Property 8).
FORBIDDEN_SUBSTRINGS = (
    "user_email",
    "user_id",
    "ws_connected_since",
    "disconnected_at",
    "_pause_started_at",
)


def _make_room(state: str, livekit_room) -> DebateRoom:
    """Build a minimal `DebateRoom` in the given state with a livekit_room."""
    return DebateRoom(
        debate_id="deb-1",
        code="ABCDEF",
        motion_id="m-1",
        motion_title="THB uniforms",
        motion_text="This house believes school uniforms should be abolished.",
        state=state,
        livekit_room=livekit_room,
        participants=[
            ParticipantInternal(
                participant_id="p-0",
                user_id="uid-0",
                user_email="a@example.com",
                display_name="Alice",
                joined_at=1.0,
                turn_index=0,
            ),
        ],
        created_at=0.0,
    )


# ---------------------------------------------------------------------------
# 1.2 — Example-based unit test for to_public phase-gating (Property 1)
# ---------------------------------------------------------------------------


def test_to_public_livekit_room_phase_gating_example() -> None:
    """`livekit_room` is exposed only in prep/speaking, hidden elsewhere.

    Property 1: Live audio phase-gating.
    Validates: Requirements 1.1.
    """
    for state in ACTIVE_STATES:
        room = _make_room(state, "debate-abcdef-1a2b3c4d")
        assert to_public(room).livekit_room == "debate-abcdef-1a2b3c4d", (
            f"livekit_room should be exposed in active state {state!r}"
        )

    for state in INACTIVE_STATES:
        room = _make_room(state, "debate-abcdef-1a2b3c4d")
        assert to_public(room).livekit_room is None, (
            f"livekit_room must be hidden in non-active state {state!r}"
        )


# ---------------------------------------------------------------------------
# 1.3 — Property test for to_public phase-gating (Property 1)
# ---------------------------------------------------------------------------

# Non-empty LiveKit room names; underscore excluded to keep the value
# distinct from any bookkeeping token (not strictly required here).
livekit_room_st = st.text(
    alphabet="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-",
    min_size=1,
    max_size=40,
)


@given(state=st.sampled_from(ALL_STATES), livekit_room=livekit_room_st)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
def test_to_public_livekit_room_phase_gating_property(
    state: str, livekit_room: str
) -> None:
    """`to_public().livekit_room is not None` iff state in {prep, speaking}.

    Property 1: Live audio phase-gating.
    Validates: Requirements 1.1.
    """
    room = _make_room(state, livekit_room)
    projected = to_public(room).livekit_room
    if state in ACTIVE_STATES:
        assert projected == livekit_room
    else:
        assert projected is None


# ---------------------------------------------------------------------------
# 1.4 — Property test for PII-safety of audio projections (Property 8)
# ---------------------------------------------------------------------------

# Adversarial values for the *exposed* string fields. Every forbidden token
# contains ``_``; this alphabet intentionally omits ``_`` so a legitimately
# exposed value can never collide with a forbidden substring. Any match in
# the JSON dump therefore proves a bookkeeping FIELD NAME leaked — which is
# exactly what Property 8 forbids for these response/broadcast models.
SAFE_ALPHABET = (
    "abcdefghijklmnopqrstuvwxyz"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "0123456789 -.@/{}"
)
adversarial_text = st.text(alphabet=SAFE_ALPHABET, min_size=0, max_size=40)

optional_url_st = st.one_of(st.none(), adversarial_text)


@st.composite
def audio_ref_st(draw) -> DebateTurnAudioRef:
    return DebateTurnAudioRef(
        turn_index=draw(st.integers(min_value=0, max_value=10)),
        participant_id=draw(adversarial_text),
        display_name=draw(adversarial_text),
        audio_url=draw(optional_url_st),
        is_forfeit=draw(st.booleans()),
    )


@st.composite
def public_room_st(draw) -> PublicDebateRoom:
    return PublicDebateRoom(
        code=draw(adversarial_text),
        state=draw(st.sampled_from(ALL_STATES)),
        paused=draw(st.booleans()),
        livekit_room=draw(st.one_of(st.none(), adversarial_text)),
        active_turn_index=draw(st.one_of(st.none(), st.integers(0, 5))),
        winner_participant_id=draw(st.one_of(st.none(), adversarial_text)),
    )


@st.composite
def detail_response_st(draw) -> DebateDetailResponse:
    n = draw(st.integers(min_value=0, max_value=4))
    return DebateDetailResponse(
        debate_id=draw(adversarial_text),
        code=draw(adversarial_text),
        motion=Motion(
            id=draw(adversarial_text),
            title=draw(adversarial_text),
            text=draw(adversarial_text),
        ),
        completed_at=draw(
            st.floats(min_value=0.0, max_value=1e10, allow_nan=False, allow_infinity=False)
        ),
        winner_participant_id=draw(st.one_of(st.none(), adversarial_text)),
        turn_audio=[draw(audio_ref_st()) for _ in range(n)],
    )


def _assert_no_pii(dumped: str) -> None:
    for forbidden in FORBIDDEN_SUBSTRINGS:
        assert forbidden not in dumped, (
            f"Forbidden substring {forbidden!r} leaked into projection JSON. "
            f"Full dump: {dumped}"
        )


@given(model=st.one_of(public_room_st(), audio_ref_st(), detail_response_st()))
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
def test_audio_projections_never_leak_pii(model) -> None:
    """Response/broadcast models never serialize internal bookkeeping tokens.

    Property 8: PII never leaks.
    Validates: Requirements 3.1, 4.4.
    """
    _assert_no_pii(model.model_dump_json())
