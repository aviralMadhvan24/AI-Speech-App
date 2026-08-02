# Bugfix Requirements Document

## Introduction

The React SPA in `frontend/` has no URL-based routing. All navigation lives in
in-memory React state in `frontend/src/App.tsx`: a single `view` state variable
(`const [view, setView] = useState<View>("main-menu")`) selects which screen is
rendered, and each activity keeps its own identifiers in component-local state
(e.g. `roomCode`/`participantId` inside `DebateArenaView` and `GDArenaView`,
`battleSession` in `App.tsx`, `activeSubmissionId`/`activeStudentEmail` for admin
views, `report` for the report view, `sentenceIdx`/`difficulty` for practice,
and `stage`/`submissionIdRef` inside `InterviewStudioView`).

Because none of this state is reflected in the URL, two browser behaviors break:

- **Page refresh (reload):** all React state resets. `view` falls back to
  `"main-menu"` and every activity identifier is lost, so the user is ejected
  from whatever they were doing (debate, GD, battle, interview, practice, report,
  profile, or an admin view) back to the main menu.
- **Browser Back:** the app never pushes in-app history entries, so pressing Back
  leaves the entire application instead of returning to the previous in-app view.

The chosen remediation is to introduce URL-based routing so that every view maps
to a URL path. A reload reloads the same route (keeping the user in their
activity), and the browser Back button navigates within the app. Live-room
activities (debate, GD, battle) carry their room code in the URL so the arena can
rehydrate and rejoin using the backend's existing reconnect support (the debate
socket auto-reconnects and the backend grants a 30s reconnect grace); the
`participantId`, which is not part of the URL, is recovered from a per-room
client-side store (e.g. `sessionStorage`/`localStorage` keyed by room code) so a
refreshed participant rejoins as the same participant. This is a frontend-only
fix (`App.tsx`, the view components, and a router); it must not require backend
API changes and must rely on the existing endpoints and reconnect behavior. The
specific routing library is left to design — the requirements are library-agnostic.

## Bug Analysis

### Glossary

- **View / Activity (V):** One of the screens selectable by the `View` union in
  `App.tsx`: `main-menu`, `home`, `practice`, `processing`, `report`,
  `battle-lobby`, `battle-room`, `battle-result`, `interview`, `debate-arena`,
  `gd-arena`, `admin-panel`, `admin-review`, `admin-student`, `profile`.
- **View context:** The minimal identifiers a view needs to render itself
  meaningfully (e.g. debate/GD room code + participant identity; battle room/battle
  id + role; report session id; admin submission id or student email; practice
  sentence index + difficulty; interview stage + submission id).
- **Route:** A URL path (and any path/query parameters) that uniquely identifies a
  view and its context.
- **Deep-link:** Navigating directly to a route (typed, bookmarked, or reloaded)
  without having navigated there in-app first.
- **Rehydrate:** Reconstruct a view's context from the route (plus any recoverable
  client-side store) after a reload so the view renders as it did before.
- **Live-room activity:** Debate, GD, or Battle — activities backed by a realtime
  socket and a server-side room identified by a room code.
- **Rejoin:** After reload, reconnecting a live-room participant to their existing
  server room using the recovered room code + participant identity, relying on the
  existing reconnect grace so the participant resumes as the same participant.
- **Participant identity recovery:** Restoring a `participantId` that is not in the
  URL from a client-side store keyed by room code.
- **Auth gating:** The existing behavior where an unauthenticated user sees the
  login screen instead of any activity view.
- **F:** The original (unfixed) app — navigation held only in in-memory state.
- **F':** The fixed app — navigation reflected in URL-based routes.
- **isBugCondition(X):** Predicate identifying the inputs that trigger the bug (a
  reload or a Back navigation while in a non-default view).

### Bug Condition and Property

```pascal
// X describes a navigation event against the running app.
// Fields:
//   X.event     ∈ { "reload", "back" }   // reload = browser refresh; back = browser Back
//   X.view      ∈ View union              // the view the user is currently in
//   X.context   = identifiers the view depends on (room code, participant id,
//                 submission id, student email, session id, sentence index, etc.)
//   X.authed    ∈ { true, false }         // whether the user is authenticated
//   X.roomAlive ∈ { true, false, n/a }    // for live-room views: does the server room still exist

FUNCTION isBugCondition(X)
  INPUT: X of type NavigationEvent
  OUTPUT: boolean

  // The bug manifests whenever a reload or an in-app Back happens while the
  // user is somewhere other than the default main-menu with no context.
  RETURN (X.event = "reload" AND X.view <> "main-menu")
      OR (X.event = "reload" AND context_is_nonempty(X.context))
      OR (X.event = "back"   AND user_navigated_within_app_before(X))
END FUNCTION
```

```pascal
// Property: Fix Checking — reload preserves view + context (or degrades gracefully)
FOR ALL X WHERE isBugCondition(X) AND X.event = "reload" DO
  result ← F'(X)
  IF X.authed = false THEN
    ASSERT result.view = "login"
       AND result.intendedRoute = route_of(X.view, X.context)   // redirect back after login
  ELSE IF is_live_room(X.view) AND X.roomAlive = false THEN
    ASSERT result.view = lobby_of(X.view) AND result.shownMessage = true  // graceful, no crash
  ELSE
    ASSERT result.view = X.view AND result.context ⊇ restorable(X.context)
  END IF
END FOR
```

```pascal
// Property: Fix Checking — browser Back navigates within the app
FOR ALL X WHERE isBugCondition(X) AND X.event = "back" DO
  result ← F'(X)
  ASSERT result.stayedInApp = true
     AND result.view = previous_in_app_view(X)
END FOR
```

```pascal
// Property: Preservation Checking — non-bug inputs behave identically
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```

**Key definitions:** **F** is the app before the fix (state-only navigation);
**F'** is the app after the fix (URL-based routing). A **counterexample** for the
current bug: a user in `debate-arena` inside room `ABC234` presses browser refresh
and lands back on `main-menu` with the room lost, or presses Back and exits the app.

### Current Behavior (Defect)

What currently happens when the bug is triggered:

1.1 WHEN the user is in any view other than `main-menu` (`home`, `practice`, `processing`, `report`, `battle-lobby`, `battle-room`, `battle-result`, `interview`, `debate-arena`, `gd-arena`, `admin-panel`, `admin-review`, `admin-student`, `profile`) AND the browser is refreshed THEN the system resets `view` to `main-menu` and drops the user out of their activity.

1.2 WHEN the user is in `debate-arena` or `gd-arena` inside a room (holding `roomCode` + `participantId` in memory) AND the browser is refreshed THEN the system loses the room code and participant identity and returns to the arena lobby / main-menu, so the user is not rejoined to their live room.

1.3 WHEN the user is in `battle-room` or `battle-result` (holding `battleSession` with room code, player id, and role in memory) AND the browser is refreshed THEN the system loses `battleSession` and returns to `main-menu`.

1.4 WHEN the user is in `interview` at a specific stage (e.g. `submitted`/`complete` with a `submissionIdRef`) AND the browser is refreshed THEN the system resets the interview to its initial stage and loses the active submission context.

1.5 WHEN the user is viewing a `report` (holding the report/session context in memory) AND the browser is refreshed THEN the system loses the report and returns to `main-menu`.

1.6 WHEN the user is in `admin-review` or `admin-student` (holding `activeSubmissionId` / `activeStudentEmail` in memory) AND the browser is refreshed THEN the system loses that identifier and returns to `main-menu`.

1.7 WHEN the user is in `practice` (holding `sentenceIdx` + `difficulty` in memory) AND the browser is refreshed THEN the system resets to the default practice state.

1.8 WHEN the user presses the browser Back button anywhere in the app THEN the system exits the entire application because no in-app history entries were ever pushed.

### Expected Behavior (Correct)

What should happen instead (each clause corresponds to the matching defect clause):

2.1 WHEN the user is in any view other than `main-menu` AND the browser is refreshed THEN the system SHALL reload the same route and remain on that same view rather than resetting to `main-menu`.

2.2 WHEN the user is in `debate-arena` or `gd-arena` inside a room AND the browser is refreshed THEN the system SHALL restore the view from the room code carried in the URL, recover the `participantId` from the per-room client-side store (keyed by room code), remount the arena, and rejoin the existing server room via the existing reconnect flow so the user resumes as the same participant.

2.3 WHEN the user is in `battle-room` or `battle-result` AND the browser is refreshed THEN the system SHALL restore the view from the battle/room identifier carried in the URL together with the recovered role, and reconnect to the same battle rather than resetting to `main-menu`.

2.4 WHEN the user is in `interview` at a resumable stage AND the browser is refreshed THEN the system SHALL restore the interview view and, where a submission exists, restore the active submission (via its id, recoverable from the URL and/or the existing my-submissions list) so review polling resumes; mid-capture stages that cannot be technically restored (e.g. an in-progress recording) SHALL return the user to the interview entry rather than to `main-menu`.

2.5 WHEN the user is viewing a `report` AND the browser is refreshed THEN the system SHALL restore the report view from the session id carried in the URL, re-fetching or re-deriving the report as needed.

2.6 WHEN the user is in `admin-review` or `admin-student` AND the browser is refreshed THEN the system SHALL restore the view from the submission id / student email carried in the URL.

2.7 WHEN the user is in `practice` AND the browser is refreshed THEN the system SHALL restore the practice view with the sentence index and difficulty carried in the URL.

2.8 WHEN the user presses the browser Back button after navigating within the app THEN the system SHALL navigate to the previous in-app view instead of leaving the application.

2.9 WHEN an unauthenticated user deep-links to or reloads any activity route THEN the system SHALL show the login screen and, after successful login, SHALL redirect the user to the originally intended route.

2.10 WHEN a user deep-links to or reloads a live-room route whose server room no longer exists (stale/nonexistent room code) THEN the system SHALL fail gracefully (e.g. redirect to the relevant lobby with an explanatory message) rather than crashing.

### Unchanged Behavior (Regression Prevention)

Existing behavior that must be preserved for inputs that do NOT trigger the bug:

3.1 WHEN a user navigates between views in-app via the main-menu tiles, activity start buttons, back buttons, and leave/exit actions (without reloading or pressing browser Back) THEN the system SHALL CONTINUE TO show the correct target view exactly as it does today.

3.2 WHEN an unauthenticated user opens the app THEN the system SHALL CONTINUE TO show the login screen and gate all activity views behind authentication.

3.3 WHEN an authenticated user is on the main menu THEN the system SHALL CONTINUE TO display the main-menu tiles (including the Admin Panel tile for teacher accounts) and launch each activity from them.

3.4 WHEN a user starts, plays, and leaves a debate, GD, battle, interview, or practice session normally (no reload/Back) THEN the system SHALL CONTINUE TO run each activity's normal start/leave flow, including live-audio, ready/forfeit, scoring, and results behavior, unchanged.

3.5 WHEN a live-room participant reconnects after a transient disconnect (as opposed to a full reload) THEN the system SHALL CONTINUE TO respect the existing reconnect and forfeit grace semantics, with no double-join and no duplicate participant created for the same person/room.

3.6 WHEN a refreshed live participant rejoins via the recovered room code + participant identity THEN the system SHALL rejoin as the same participant, CONTINUING TO honor the existing reconnect grace and NOT creating a second participant entry.

3.7 WHEN the fix is implemented THEN it SHALL remain frontend-only, CONTINUING TO use the existing backend endpoints and reconnect behavior with no backend API changes required.
