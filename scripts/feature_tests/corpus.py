"""Controlled content corpus used to probe scoring behaviour.

Each sample pairs a transcript with the delivery signals (clarity, wpm,
duration) that would normally come out of the ASR + fluency pipeline. Fixing
both halves makes score comparisons across content types meaningful: only
the content varies, delivery is held roughly constant.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Motion:
    id: str
    title: str
    text: str


@dataclass(frozen=True)
class Sample:
    key: str
    label: str
    text: str
    clarity: float          # 0-100, stands in for fluency clarity_score
    wpm: float
    duration_seconds: float
    expectation: str        # human-readable note shown in the report

    @property
    def word_count(self) -> int:
        return len(self.text.split())


# The debate motion is pinned (instead of the random one the room picks) so
# on-topic and off-topic samples are unambiguous.
DEBATE_MOTION = Motion(
    id="social_media_teens",
    title="Social Media Does More Harm Than Good for Teenagers",
    text=(
        "This house believes that social media platforms cause more harm than "
        "benefit to teenagers, considering mental health, academic focus, sleep, "
        "and real-world social development."
    ),
)

GD_TOPIC = Motion(
    id="wfh_vs_office",
    title="Work From Home vs Office",
    text=(
        "Discuss the pros and cons of work-from-home culture versus traditional "
        "office work. Consider productivity, work-life balance, career growth, "
        "and team collaboration."
    ),
)


# --- Debate samples (all judged against DEBATE_MOTION) --------------------

STRONG = Sample(
    key="strong",
    label="Strong, on-topic, structured",
    clarity=82.0,
    wpm=132.0,
    duration_seconds=118.0,
    expectation="highest content score; should win the debate",
    text=(
        "I stand firmly for the motion that social media does more harm than good "
        "for teenagers, and I will defend this on three grounds: mental health, "
        "academic focus, and the erosion of real friendship. "
        "First, mental health. Platforms are engineered around infinite scroll and "
        "social comparison. A teenager sees a curated highlight reel of two hundred "
        "peers every single evening, and measures her ordinary life against it. "
        "Clinical studies across the last decade report rising rates of anxiety and "
        "body-image distress among heavy adolescent users, and the pattern tracks "
        "the arrival of smartphones in that age group. "
        "Second, academic focus. Attention is the raw material of learning. When a "
        "student switches to a notification every few minutes, deep work becomes "
        "impossible. My opponents will say discipline solves this, but we should not "
        "ask a fifteen-year-old to out-discipline a recommendation engine built by "
        "thousands of engineers to hold her attention. "
        "Third, real social development. Face-to-face conflict teaches negotiation "
        "and empathy. A block button teaches avoidance. "
        "I will concede the obvious benefit: social media connects isolated "
        "teenagers, especially those in minority communities, to people who "
        "understand them. That is real. But the question is net effect, and a "
        "narrow benefit for some does not outweigh a broad, measurable harm to "
        "sleep, attention, and self-worth for the majority. "
        "For these reasons, the motion must stand."
    ),
)

MODERATE = Sample(
    key="moderate",
    label="On-topic but vague, little evidence",
    clarity=79.0,
    wpm=126.0,
    duration_seconds=95.0,
    expectation="mid-range content score; below the strong speech",
    text=(
        "I think social media is mostly bad for teenagers and I agree with the "
        "motion. Teenagers use it a lot these days, maybe too much, and that is "
        "not a good thing for them. It can make them feel bad about themselves "
        "sometimes when they see other people posting. Also they spend a lot of "
        "time on it instead of studying, which affects their marks. Some people "
        "say it is useful for talking to friends and that is true, you can stay "
        "in touch easily, but overall I feel the bad things are more than the "
        "good things. Parents are also worried about this issue nowadays and I "
        "think they are right to be worried. So my conclusion is that social "
        "media does more harm than good for teenagers and something should be "
        "done about it by the platforms and by schools."
    ),
)

SHORT = Sample(
    key="short",
    label="On-topic but far too short",
    clarity=80.0,
    wpm=120.0,
    duration_seconds=14.0,
    expectation="length penalty must cut the content score hard",
    text=(
        "Social media is harmful for teenagers because it wastes their time and "
        "affects their mental health. I support the motion."
    ),
)

OFF_TOPIC = Sample(
    key="off_topic",
    label="Fluent delivery, completely off-topic",
    clarity=86.0,
    wpm=138.0,
    duration_seconds=112.0,
    expectation="off-topic penalty must dominate; near-bottom final score",
    text=(
        "Let me talk about my favourite thing in the world, which is food. "
        "Pizza is genuinely the greatest dish ever invented and I will explain "
        "why in detail. The base has to be thin and slightly charred, because a "
        "thick base soaks up the sauce and turns soggy within minutes. The sauce "
        "should be San Marzano tomatoes, a little salt, nothing else. People add "
        "sugar and that is a mistake. For cheese, fresh mozzarella beats the "
        "processed shredded variety every time, and it should be torn by hand, "
        "not sliced. My uncle runs a small restaurant near the railway station "
        "and he taught me that the oven temperature matters more than any "
        "ingredient. Four hundred and fifty degrees, ninety seconds, and you get "
        "a perfect crust. Last month I also started following cricket again "
        "because the season began, and I watched three matches in one weekend. "
        "The bowling was excellent, especially in the second innings."
    ),
)

GIBBERISH = Sample(
    key="gibberish",
    label="Filler-only, no argument",
    clarity=48.0,
    wpm=88.0,
    duration_seconds=60.0,
    expectation="bottom of the range; no scoreable argument",
    text=(
        "So basically, um, like, I mean the thing is that, you know, basically "
        "it is like that only. Um, so yeah, like, what I am saying is, um, "
        "basically the same thing, you know. Like, um, so, basically, yeah. "
        "It is, um, like, you know, basically that. So, um, yeah, like, I mean, "
        "basically, um, you know, like, that is it, basically, yeah, um."
    ),
)

DEBATE_SAMPLES: tuple[Sample, ...] = (STRONG, MODERATE, SHORT, OFF_TOPIC, GIBBERISH)

# The four speakers used in the full debate run, in turn order.
DEBATE_LINEUP: tuple[Sample, ...] = (STRONG, MODERATE, OFF_TOPIC, SHORT)


# --- GD samples (all judged against GD_TOPIC) ----------------------------

GD_STRONG = Sample(
    key="gd_strong",
    label="Strong, on-topic, builds on others",
    clarity=84.0,
    wpm=134.0,
    duration_seconds=0.0,
    expectation="highest content quality in the GD",
    text=(
        "I want to open by framing the trade-off honestly: remote work wins on "
        "focus and commute time, office work wins on informal learning. For a "
        "senior engineer who already knows the codebase, home is more productive, "
        "because deep work needs uninterrupted blocks. For a fresher in her first "
        "six months, the office is worth far more, because she learns by "
        "overhearing how seniors debug and negotiate. "
        "Building on what was said about work-life balance, I would add a caution: "
        "remote work removes the commute but it also removes the boundary. Many "
        "people end up working longer, not less, because the laptop never leaves "
        "the room. So the honest answer is hybrid, with in-office days scheduled "
        "for design discussions and reviews, and remote days protected for "
        "execution. That gives us collaboration without sacrificing focus."
    ),
)

GD_MODERATE = Sample(
    key="gd_moderate",
    label="On-topic, generic points",
    clarity=77.0,
    wpm=122.0,
    duration_seconds=0.0,
    expectation="mid content quality",
    text=(
        "Work from home is quite good in my opinion because you save travel time "
        "and you can work comfortably from your own place. But office is also "
        "important because you meet your team and there is better communication "
        "face to face. Both have advantages and disadvantages honestly. It "
        "depends on the person and the type of job they are doing. For IT jobs "
        "work from home is fine but for other jobs maybe office is needed. So a "
        "mix of both would probably be the best solution for most companies."
    ),
)

GD_SHORT = Sample(
    key="gd_short",
    label="Minimal participation",
    clarity=75.0,
    wpm=118.0,
    duration_seconds=0.0,
    expectation="low participation score; content thin",
    text="Yes I agree with the previous speaker, work from home is convenient.",
)

GD_OFF_TOPIC = Sample(
    key="gd_off_topic",
    label="Off-topic in a GD",
    clarity=83.0,
    wpm=130.0,
    duration_seconds=0.0,
    expectation="content quality must be flagged off-topic",
    text=(
        "Actually I wanted to tell everyone about the trip I took to Manali last "
        "winter. The snow started on the second day and the roads were blocked "
        "so we stayed in a small guest house near the market. The food there was "
        "amazing, especially the local trout, and the owner told us stories about "
        "the old trade routes through the mountains. Photography was excellent in "
        "the morning light. I am planning to go again in December if I can get "
        "the tickets booked early enough this time."
    ),
)
