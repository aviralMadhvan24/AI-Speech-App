# KIET Soft Skills Platform — Overview

*A simple, non-technical guide to what the platform does, how it grades students, how reliable it is, and what it costs to run.*

---

## 1. The Big Picture

Employers everywhere say the same thing: students have the degrees, but many struggle to **speak clearly, argue a point, and carry themselves well in interviews**. Colleges have very few ways to give every student real, personal practice at these "soft skills" — a teacher simply cannot sit one-on-one with hundreds of students.

**Our platform solves this.** It is a website where students practise speaking, debating, discussing, and interviewing — and an **AI coach gives them an instant score and personal feedback**, any time of day, as many times as they want. Teachers get a dashboard to track everyone and step in when needed.

Think of it as a **"speaking gym" with an AI personal trainer** for every student.

**Who uses it**
- **Students** — practise and improve, on their own schedule.
- **Teachers** — monitor progress, review results, adjust scores, and export reports.

Access is limited to verified college accounts (Google sign-in), so it's a safe, closed environment.

---

## 2. What Students Can Do (The Practice Modes)

### 🎤 Pronunciation Practice
Students read a sentence aloud. The AI checks **how correctly they pronounced each word, how clearly they spoke, and how fast** — then gives simple, encouraging feedback like "Understandable, practice for clarity."

### ⚔️ 1v1 Battle
Two students record the **same sentence and compete**. The app crowns a winner based on pronunciation, clarity, and speaking pace. This adds a fun, competitive, game-like element that keeps students coming back.

### 🗣️ Debate (Head-to-Head)
A **one-on-one debate** between two students on a real topic ("motion"). Each gets a turn to argue their side. **Both students can hear each other's voice live** during the debate, and can **play back each other's recorded turns** — so it feels like a real face-to-face exchange, not just isolated recordings. The **AI acts as a judge** — it doesn't just check *how* they spoke, it now understands **what they actually argued**: is it on-topic, are the points logical, is it well-structured, is the vocabulary strong. A winner is chosen, and teachers can override the result.

### 👥 Group Discussion (GD)
A realistic **group discussion for 5–10 students**, just like the GD rounds companies use in hiring. **Everyone can hear each other's voices live** as the discussion flows, taking turns speaking for about 15 minutes. The AI then **ranks each participant individually** on the quality of their ideas, how well they communicated, how much they participated, whether they listened and built on others' points, and whether they showed leadership.

> **Live voice interaction** in both Debate and Group Discussion is powered by real-time audio, so participants genuinely talk and listen to one another. An enhanced **voice playback** experience (replaying each speaker's audio smoothly within the session) is **currently in progress**.

### 🎬 Interview Studio
Students record a **video answer** to an interview question. The AI watches the video like a coach and scores their **body language** — eye contact, posture, hand gestures, calmness, and facial expression. This is the kind of feedback students almost never get before a real interview.

### 👤 My Profile
Every student has a personal profile showing their history and progress over time — so improvement is visible and motivating.

### 🧑‍🏫 Teacher Admin Panel
Teachers get a full dashboard: see every session, review debates, discussions and interviews, override any AI score, add written feedback, and **export everything to Excel** for records and grading.

---

## 3. How the AI Grading Works (In Plain English)

Every score is out of **100 — higher is better**. The platform doesn't just judge *how nicely* someone speaks; it now also judges **the substance of what they say**, using an AI language model that reads the transcript like a human examiner would.

**Why this matters:** most speech tools only check pronunciation. Our AI **understands meaning** — it can tell the difference between a fluent student who is *off-topic* and one who makes a *strong, relevant argument*. The system is deliberately strict: an off-topic or empty answer is automatically capped at a low score, so students can't game it by just talking smoothly. Teachers always have the final say and can override any result.

Here is exactly what each mode measures.

### Pronunciation Practice
- **Pronunciation** — how correctly each sound was said, compared against a 135,000-word dictionary. Wrong or missing sounds are penalised harder than extra sounds, and mistakes in short sentences are penalised more.
- **Clarity** — how confidently the system recognised each word.
- **Speaking speed** — words per minute (under 120 = slow, 120–160 = ideal, over 160 = too fast).
- **Word match** — did they say the right words, with tips on specific mistakes (e.g. silent letters in "subtle").

### 1v1 Battle — "best of 3 stars"
Both players are compared on three things, each worth one star:
- **Pronunciation star** (tie if within 5 points)
- **Clarity star** (tie if within 5 points)
- **Pace star** — closest to the ideal **145 words per minute** wins
Whoever wins more stars wins the round; equal stars = a draw. (Can be played as multiple rounds.)

### Debate — content is half the score
Each speaker's turn is scored out of 100:
- **Content (50%)** — judged by the AI: Relevance to the motion (0–15), Argument quality (0–15), Structure (0–10), Vocabulary (0–10).
- **Fluency / clarity (25%)**
- **Pronunciation (25%)** — *note: intentionally skipped for debate so results come back fast; the score is fairly rebalanced across the remaining parts.*
- **Strict safeguards:** an **off-topic** speech is capped at 20, an empty/irrelevant one at 15, and very short speeches are penalised. 
- **Winner:** higher score wins; an exact tie is an honest **draw** (no tiebreakers). Teacher can override.

### Group Discussion — ranked out of 100
Each participant is scored and ranked on five things:
- **Content quality — 30%** (AI-judged relevance and depth of ideas)
- **Communication — 20%** (pronunciation + fluency)
- **Participation — 20%** (how much they spoke and how often)
- **Listening — 15%** (AI checks if they referenced and built on others' points)
- **Leadership — 15%** (first to speak, driving the discussion, good etiquette / not interrupting)
Off-topic or silent participants are capped low, so quality wins over just talking a lot.

### Interview Studio — body language on video
The video is scored on five signals, combined into one score:
- **Eye contact — 25%** (looking at the camera)
- **Posture — 20%** (sitting/standing straight)
- **Gestures — 20%** (hands away from the face)
- **Facial expression — 20%** (natural, positive expression)
- **Stillness — 15%** (calm, not fidgeting)
If the camera can't clearly read one signal, it's dropped and the others are fairly rebalanced. Students get friendly, specific tips for each area.

---

## 4. Built to Keep Working — Our Reliability & Fallbacks

A big strength of the platform is that it **degrades gracefully** — if one part is unavailable, the rest keeps running so a student is never left stuck. This is important for real classroom use.

- **AI grading has a backup brain.** The AI examiner runs on a fast cloud service by default, and can automatically switch to a **local AI** running on the college's own machine. If both are somehow unavailable, the student still gets a score based on their speaking delivery, clearly marked for the teacher to review.
- **Speech-to-text has two engines.** The system can convert speech to text using either a cloud service (fast) or its own built-in engine (private, no internet needed) — whichever is available.
- **Debate stays fast.** For debates, the platform intelligently **skips the slowest checks** and focuses on content and fluency, so results come back quickly instead of making students wait.
- **Group discussion is fair even solo.** If someone is testing alone or the AI examiner is busy, the system falls back to sensible default scores rather than crashing.
- **Interview video is safe.** If the video-analysis service is momentarily unavailable, the student gets a clear message instead of a broken screen, and the attempt can still be saved for teacher review.
- **Teachers are the ultimate fallback.** Every AI score can be **overridden by a teacher**, so human judgement always wins.
- **Nothing is lost.** Sessions and results are saved automatically, even if a student disconnects mid-way.

In short: **the platform is designed so a single glitch never takes down the whole experience.**

---

## 5. What It Costs to Run (In Rupees)

The platform is remarkably cheap to operate because it leans on generous free tiers (secure login, cloud AI, security certificates, and a free web address are all **₹0**). We only pay for the server that hosts it.

> Amounts are approximate (cloud is billed in US dollars at about ₹88 = $1) and depend slightly on the exchange rate.

| Option | Monthly cost (₹) | All features? | Best for |
|--------|------------------|---------------|----------|
| **Small server (AWS t3.micro)** | **₹0 – ₹900** | Most features (no video interview) | Absolute lowest cost — **FREE for the first 12 months** |
| **Fly.io** ⭐ | **₹450 – ₹1,300** | ✅ Everything | Best value — sleeps when idle, so you barely pay when no one's using it |
| **Full server (AWS t3.medium)** | **₹3,000 – ₹3,500** | ✅ Everything | Heavy daily use / demos, 50–100 users at once |

Even the full-power option can be run for as little as **~₹700/month** by switching it off outside class hours.

---

## 6. The Cheapest Way to Run It

- **Lowest possible cost:** the small server is **free for the first year** (then ~₹750–900/month), but leaves out the video interview feature.
- **Cheapest option that still includes *every* feature:** **Fly.io at roughly ₹450–1,300/month** — and less, because it automatically sleeps when nobody is online and wakes up in seconds when a student visits.

**Our recommendation:** run on **Fly.io**. For under the price of a couple of coffees a month, the college gets the **complete platform** — every practice mode, AI grading, and the teacher dashboard — with almost nothing wasted on idle time.

**Always free, on every option:** secure Google login, the AI grading service (free tier), website security (HTTPS), and the web address.

---

## 7. Why This Is a Strong Opportunity

- **Real, unmet need.** Every college has thousands of students and only a handful of soft-skills trainers. We give personal practice to all of them.
- **AI that understands meaning, not just sound.** Our debate and discussion grading reads *what* students argue — a genuine step beyond ordinary pronunciation apps.
- **Engaging by design.** Battles, debates, and discussions make practice feel like a game, driving repeat use.
- **Teacher-in-the-loop.** AI does the heavy lifting; teachers keep control and credibility.
- **Extremely low running cost.** The whole platform runs for roughly the price of a few cups of coffee per month.
- **Reliable in the real world.** Smart fallbacks mean it keeps working even when a piece fails.

---

## 8. Current Status

- **Live and in use**, accessed securely over the internet.
- **Working today:** Pronunciation, 1v1 Battle, Debate (with AI content grading), Group Discussion (with AI content grading), Interview Studio (body-language grading), student profiles, and the full teacher admin panel with Excel export.
- **Live voice** in Debate and Group Discussion is working — participants hear each other in real time and can play back each other's turns.
- **In progress:** an enhanced **voice playback** experience for Debate and Group Discussion (smoother replay of each speaker's audio within the session).
- **Rolling out:** AI *answer-content* grading for interviews (the body-language grading is already live).
- Voice Cruise Control was removed to keep the experience focused.

---

*Prepared as a simple overview for discussion. Figures in rupees are approximate (≈ ₹88 per US dollar) and vary with the exchange rate.*
