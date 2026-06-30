# Requirements Document

## Introduction

The Communication Skills Analyzer (CSA) is a local web-based application that helps college students practice for interviews, group discussions, and presentations by analyzing their body language from a short self-recorded webcam video. Phase 1 focuses exclusively on rule-based body language analysis using MediaPipe pose, face, and hand landmarks. The system produces a per-metric score, an overall score, actionable textual feedback, and a visual chart report. The architecture is modular so that future analysis modules (pronunciation, vocabulary, GD timer, interview question bank) can be added in later phases without modifying Phase 1 code.

## Glossary

- **Communication_Skills_Analyzer**: The complete system, comprising the browser frontend and the Python backend, that records a video and returns a body language analysis report.
- **Frontend**: The browser-based user interface that captures webcam video and displays the report.
- **Backend**: The Python web service (Flask or FastAPI) that receives video, runs analysis modules, and returns results.
- **Analysis_Module**: A self-contained component that consumes processed video frames or landmark data and produces a metric score and feedback. Each Analysis_Module lives in its own folder.
- **Body_Language_Module**: The Phase 1 Analysis_Module that bundles the five body language analyzers listed below.
- **Posture_Analyzer**: Component that scores posture using shoulder, hip, and neck landmark angles from MediaPipe Pose.
- **Eye_Contact_Analyzer**: Component that scores eye contact and head orientation using MediaPipe Face Mesh landmarks and head pose estimation.
- **Gesture_Analyzer**: Component that scores hand gestures (open gestures, hand-to-face, crossed arms) using MediaPipe Hands and Pose landmarks.
- **Stillness_Analyzer**: Component that scores fidgeting versus controlled stillness using frame-to-frame landmark movement variance.
- **Facial_Expression_Analyzer**: Component that scores smile frequency and facial expressiveness using MediaPipe Face Mesh landmarks.
- **Scoring_Engine**: Component that combines per-metric scores into an overall score using configured weights.
- **Feedback_Generator**: Component that converts numeric scores into short, actionable textual suggestions for the student.
- **Report_Generator**: Component that produces a visual report containing charts and feedback text.
- **Module_Registry**: A backend mechanism that discovers and loads Analysis_Modules from a defined folder location, so future modules can be added without code changes in existing modules.
- **Session**: A single end-to-end use of the system, from starting recording to viewing the report.
- **Landmark**: A 2D or 3D point produced by MediaPipe identifying a specific anatomical location.
- **Score**: An integer from 0 to 100 representing performance on one metric, where higher is better.
- **Overall_Score**: A weighted average of all per-metric scores, on the same 0 to 100 scale.

## Requirements

### Requirement 1: Webcam Video Recording

**User Story:** As a college student, I want to record a short mock interview or presentation through my browser, so that I can analyze my body language without installing extra software.

#### Acceptance Criteria

1. WHEN the student opens the Frontend in a supported browser, THE Frontend SHALL display a recording screen with a live webcam preview and a Start button.
2. WHEN the student clicks the Start button, THE Frontend SHALL begin recording video and audio from the default webcam and microphone.
3. WHILE recording is in progress, THE Frontend SHALL display an elapsed time counter and a Stop button.
4. WHILE the elapsed recording time is less than 30 seconds, THE Frontend SHALL keep the Stop button disabled.
5. WHEN the elapsed recording time reaches 30 seconds, THE Frontend SHALL enable the Stop button.
6. WHEN the elapsed recording time reaches 120 seconds, THE Frontend SHALL automatically stop the recording.
7. WHEN the student clicks the enabled Stop button before 120 seconds, THE Frontend SHALL stop the recording and retain the captured video.
8. IF the browser denies webcam or microphone permission, THEN THE Frontend SHALL display a message instructing the student to grant permission and SHALL disable the Start button.

### Requirement 2: Video Submission and Processing Lifecycle

**User Story:** As a student, I want my recorded video to be processed and a report returned, so that I can review my performance.

#### Acceptance Criteria

1. WHEN the student confirms submission of a recorded video, THE Frontend SHALL send the video file to the Backend over HTTP.
2. WHEN the Backend receives a video file, THE Backend SHALL assign the file a unique Session identifier and SHALL store the file in a local session directory.
3. WHEN a video is stored for a Session, THE Backend SHALL invoke the Body_Language_Module with the stored video path.
4. WHILE processing is in progress for a Session, THE Backend SHALL expose a status endpoint that returns the current state as one of: queued, processing, completed, or failed.
5. WHEN processing for a Session completes successfully, THE Backend SHALL persist the report data to the Session directory and SHALL set the Session state to completed.
6. IF the uploaded file is not a video format supported by OpenCV, THEN THE Backend SHALL set the Session state to failed and SHALL return an error message identifying the unsupported format.
7. IF processing raises an unhandled exception, THEN THE Backend SHALL set the Session state to failed, SHALL log the exception, and SHALL return an error message to the Frontend.
8. WHEN the video duration is between 30 and 120 seconds inclusive, THE Backend SHALL complete processing within 3 times the video duration on the reference hardware specified in the design document.

### Requirement 3: Posture Analysis

**User Story:** As a student, I want my posture evaluated, so that I know whether I am slouching during the recording.

#### Acceptance Criteria

1. WHEN the Body_Language_Module invokes the Posture_Analyzer with a video, THE Posture_Analyzer SHALL extract MediaPipe Pose Landmarks from each sampled frame.
2. THE Posture_Analyzer SHALL compute, per sampled frame, the neck-to-shoulder angle and the shoulder-to-hip vertical alignment angle.
3. THE Posture_Analyzer SHALL classify each sampled frame as upright when the neck-to-shoulder angle is within 15 degrees of vertical and the shoulder-to-hip alignment is within 10 degrees of vertical, and SHALL classify the frame as slouching otherwise.
4. THE Posture_Analyzer SHALL produce a posture Score equal to the percentage of sampled frames classified as upright, rounded to the nearest integer.
5. IF Pose Landmarks cannot be detected in more than 50 percent of sampled frames, THEN THE Posture_Analyzer SHALL return a posture Score of 0 and SHALL flag the metric as low-confidence in the report.

### Requirement 4: Eye Contact and Head Orientation Analysis

**User Story:** As a student, I want feedback on whether I maintained eye contact with the camera, so that I learn to look at the interviewer.

#### Acceptance Criteria

1. WHEN the Body_Language_Module invokes the Eye_Contact_Analyzer with a video, THE Eye_Contact_Analyzer SHALL extract MediaPipe Face Mesh Landmarks from each sampled frame.
2. THE Eye_Contact_Analyzer SHALL estimate the head yaw and pitch angles in degrees, relative to the camera optical axis, from the Face Mesh Landmarks of each sampled frame.
3. THE Eye_Contact_Analyzer SHALL classify each sampled frame as on-camera when the absolute head yaw is strictly less than 15 degrees and the absolute head pitch is strictly less than 15 degrees, and SHALL classify the frame as off-camera otherwise.
4. THE Eye_Contact_Analyzer SHALL produce an eye contact Score equal to the percentage of sampled frames classified as on-camera, rounded to the nearest integer.
5. IF a face is detected in zero percent of sampled frames, THEN THE Eye_Contact_Analyzer SHALL return the eye contact Score as a distinct unavailable value and SHALL flag the metric as detection-failed in the report.
6. IF a face is detected in more than zero percent but less than or equal to 50 percent of sampled frames, THEN THE Eye_Contact_Analyzer SHALL return an eye contact Score of 0 and SHALL flag the metric as low-confidence in the report.

### Requirement 5: Hand Gesture Analysis

**User Story:** As a student, I want feedback on my hand gestures, so that I can avoid nervous habits and use open gestures.

#### Acceptance Criteria

1. WHEN the Body_Language_Module invokes the Gesture_Analyzer with a video, THE Gesture_Analyzer SHALL extract MediaPipe Hands Landmarks and MediaPipe Pose Landmarks from each sampled frame.
2. THE Gesture_Analyzer SHALL classify each sampled frame into exactly one of the following categories: hand_to_face, crossed_arms, open_gesture, hands_at_rest, or hands_not_visible.
3. THE Gesture_Analyzer SHALL classify a frame as hand_to_face when any hand landmark is within 10 percent of the frame diagonal distance from any face landmark.
4. THE Gesture_Analyzer SHALL classify a frame as crossed_arms when the left wrist landmark x-coordinate is greater than the right shoulder landmark x-coordinate and the right wrist landmark x-coordinate is less than the left shoulder landmark x-coordinate.
5. THE Gesture_Analyzer SHALL classify a frame as open_gesture when both wrist landmarks are below shoulder level, the horizontal distance between the wrists exceeds the shoulder width, and the frame does not meet the hand_to_face or crossed_arms conditions.
6. THE Gesture_Analyzer SHALL produce a gesture Score computed as the percentage of sampled frames classified as open_gesture or hands_at_rest, rounded to the nearest integer.
7. THE Gesture_Analyzer SHALL produce per-category frame counts for the report.
8. IF the input video produces zero sampled frames, THEN THE Gesture_Analyzer SHALL return the gesture Score as a distinct unavailable value and SHALL flag the metric as no-frames in the report.

### Requirement 6: Stillness and Fidgeting Analysis

**User Story:** As a student, I want feedback on fidgeting, so that I can present myself as calm and composed.

#### Acceptance Criteria

1. WHEN the Body_Language_Module invokes the Stillness_Analyzer with a video, THE Stillness_Analyzer SHALL extract MediaPipe Pose Landmarks from each sampled frame.
2. THE Stillness_Analyzer SHALL compute the per-frame displacement of the nose, left wrist, and right wrist landmarks relative to the previous sampled frame, normalized by the frame diagonal.
3. THE Stillness_Analyzer SHALL compute the mean and variance of the per-frame displacement series for the full recording.
4. THE Stillness_Analyzer SHALL produce a stillness Score on the 0 to 100 scale, where a normalized displacement variance at or below 0.0005 maps to 100, a variance at or above 0.01 maps to 0, and intermediate values map linearly.
5. IF fewer than two sampled frames contain detectable Pose Landmarks, THEN THE Stillness_Analyzer SHALL return a stillness Score of 0 and SHALL flag the metric as low-confidence in the report.

### Requirement 7: Facial Expression Analysis

**User Story:** As a student, I want feedback on my facial expressiveness and smile, so that I appear engaged and approachable.

#### Acceptance Criteria

1. WHEN the Body_Language_Module invokes the Facial_Expression_Analyzer with a video, THE Facial_Expression_Analyzer SHALL extract MediaPipe Face Mesh Landmarks from each sampled frame.
2. THE Facial_Expression_Analyzer SHALL compute, per sampled frame, a smile metric defined as the ratio of mouth corner horizontal distance to inter-eye horizontal distance.
3. THE Facial_Expression_Analyzer SHALL classify each sampled frame as smiling when the smile metric exceeds 0.45, and as not_smiling otherwise.
4. THE Facial_Expression_Analyzer SHALL produce a facial expression Score equal to the percentage of sampled frames classified as smiling, capped at 80 to avoid penalizing students for not smiling continuously, and rescaled so that 0 to 80 percent smiling maps linearly to a 0 to 100 Score.
5. IF a face is detected in zero percent of sampled frames, THEN THE Facial_Expression_Analyzer SHALL return the facial expression Score as a distinct unavailable value and SHALL flag the metric as student-absent in the report.
6. IF a face is detected in more than zero percent but less than or equal to 50 percent of sampled frames, THEN THE Facial_Expression_Analyzer SHALL return a facial expression Score of 0 and SHALL flag the metric as low-confidence in the report.

### Requirement 8: Scoring Engine

**User Story:** As a student, I want a single overall score, so that I can quickly understand my performance.

#### Acceptance Criteria

1. WHEN all per-metric Scores for a Session are available, THE Scoring_Engine SHALL compute the Overall_Score as the weighted average of the per-metric Scores using weights defined in a configuration file.
2. THE Scoring_Engine SHALL round the Overall_Score to the nearest integer in the 0 to 100 range.
3. WHERE no per-metric Score is flagged as low-confidence, detection-failed, no-frames, or student-absent, THE Scoring_Engine SHALL use the per-metric weights as defined in the configuration file without rescaling them.
4. WHERE one or more per-metric Scores are flagged as low-confidence, detection-failed, no-frames, or student-absent, THE Scoring_Engine SHALL exclude those Scores from the weighted average and SHALL rescale the remaining weights to sum to 1.
5. IF every per-metric Score is flagged as low-confidence, detection-failed, no-frames, or student-absent, THEN THE Scoring_Engine SHALL return an Overall_Score of 0 and SHALL flag the Session as low-confidence in the report.
6. THE Scoring_Engine SHALL record, for each per-metric Score, the weight that was applied to it when computing the Overall_Score.

### Requirement 9: Actionable Feedback Generation

**User Story:** As a student, I want actionable suggestions tied to my scores, so that I know exactly what to improve.

#### Acceptance Criteria

1. WHEN per-metric Scores are available for a Session, THE Feedback_Generator SHALL produce at least one textual suggestion for each metric whose Score is below 70.
2. THE Feedback_Generator SHALL select suggestion text from a configured suggestion bank that maps metric and score band to suggestion strings, where score bands are defined as 0 to 39, 40 to 69, and 70 to 100.
3. WHERE a metric Score is in the 70 to 100 band, THE Feedback_Generator SHALL produce a single positive reinforcement message for that metric.
4. THE Feedback_Generator SHALL output suggestions as a structured list of objects, each containing the metric name, the Score, the score band, and the suggestion text.
5. WHERE a metric is flagged as low-confidence, detection-failed, no-frames, or student-absent, THE Feedback_Generator SHALL produce a re-record message asking the student to re-record with better lighting and full upper body visibility for that metric, in addition to any performance-band suggestion produced for that metric.

### Requirement 10: Visual Report

**User Story:** As a student, I want to view a visual report after analysis, so that I can interpret my results easily.

#### Acceptance Criteria

1. WHEN the Frontend detects that a Session state has transitioned to completed, THE Frontend SHALL fetch the report data from the Backend and SHALL display the report screen.
2. THE Frontend SHALL display the Overall_Score prominently at the top of the report screen.
3. THE Frontend SHALL display a bar chart showing each per-metric Score on the 0 to 100 scale.
4. THE Frontend SHALL display, for the gesture metric, a breakdown chart showing the per-category frame counts from the Gesture_Analyzer.
5. THE Frontend SHALL display the list of textual suggestions from the Feedback_Generator grouped by metric.
6. THE Frontend SHALL provide a button that allows the student to start a new recording Session from the report screen.
7. WHERE the Session is flagged as low-confidence, THE Frontend SHALL display a banner explaining that the result is low-confidence and listing the affected metrics.

### Requirement 11: Modular Architecture and Module Registry

**User Story:** As the developer, I want a modular architecture, so that future Analysis_Modules such as pronunciation, vocabulary, GD timer, and interview question bank can be added without modifying existing modules.

#### Acceptance Criteria

1. THE Backend SHALL organize each Analysis_Module in its own folder under a top-level modules directory, where each folder contains the module code, configuration, and tests.
2. THE Backend SHALL define an Analysis_Module interface that specifies a single entry-point function accepting a video file path and a configuration object, and returning a result object containing per-metric Scores, per-metric flags, and per-metric feedback inputs.
3. WHEN the Backend starts, THE Module_Registry SHALL discover every Analysis_Module present in the modules directory by reading a manifest file in each module folder.
4. THE Module_Registry SHALL expose an endpoint that returns the list of registered Analysis_Modules with their identifiers, display names, and version strings.
5. WHEN the Backend processes a Session, THE Backend SHALL invoke only the Analysis_Modules listed in the Session request, defaulting to the Body_Language_Module when no list is provided.
6. WHERE an Analysis_Module manifest is malformed or its entry point cannot be imported, THE Module_Registry SHALL skip that module, SHALL log a registration error, and SHALL continue loading the remaining modules.
7. IF the Body_Language_Module fails to register at Backend startup, THEN THE Backend SHALL reject all Session creation requests with an error indicating that no analysis modules are available.
8. IF a Session request lists an Analysis_Module that is not present in the Module_Registry, THEN THE Backend SHALL reject the Session request with an error identifying the missing module.
9. THE Body_Language_Module SHALL be implemented as a single Analysis_Module that internally composes the Posture_Analyzer, Eye_Contact_Analyzer, Gesture_Analyzer, Stillness_Analyzer, and Facial_Expression_Analyzer.

### Requirement 12: Configuration of Thresholds and Weights

**User Story:** As the developer, I want thresholds and weights stored in configuration files, so that I can tune the system without changing code.

#### Acceptance Criteria

1. THE Backend SHALL read all numeric thresholds used by the Posture_Analyzer, Eye_Contact_Analyzer, Gesture_Analyzer, Stillness_Analyzer, and Facial_Expression_Analyzer from a configuration file located in the Body_Language_Module folder.
2. THE Backend SHALL read the per-metric weights used by the Scoring_Engine from the same configuration file.
3. THE Backend SHALL read the suggestion bank used by the Feedback_Generator from a configuration file located in the Body_Language_Module folder.
4. WHERE the configuration file is present but individual analyzer threshold fields are missing, THE Backend SHALL substitute the missing fields with built-in default values, SHALL log a warning naming each substituted field, and SHALL continue startup.
5. IF the configuration file is absent or unparseable, THEN THE Backend SHALL fail to start and SHALL log a configuration error identifying the file path and the parse error.
6. IF the suggestion bank is missing any metric required by Requirement 9, THEN THE Backend SHALL fail to start and SHALL log a configuration error identifying the missing metric entries.
7. WHEN a configuration file is updated and the Backend is restarted, THE Backend SHALL apply the updated values to all subsequent Sessions.

### Requirement 13: Local Single-User Operation

**User Story:** As a college student running this on my own laptop, I want the system to run locally without accounts or cloud services, so that setup is simple and my videos stay on my machine.

#### Acceptance Criteria

1. THE Backend SHALL run as a local process that listens on a configurable port on the loopback interface.
2. THE Frontend SHALL be served by the Backend on the same port.
3. THE Backend SHALL store all Session videos and reports in a local data directory configured at startup.
4. THE Backend SHALL not transmit Session videos or reports to any external network endpoint.
5. WHEN the Backend starts, THE Backend SHALL print the local URL at which the Frontend is reachable.

### Requirement 14: Session History and Retention

**User Story:** As a student, I want to review my previous Sessions, so that I can track my progress over time.

#### Acceptance Criteria

1. WHEN the Frontend loads the home screen, THE Frontend SHALL fetch and display a list of past Sessions ordered by Session timestamp descending.
2. THE Backend SHALL expose an endpoint that returns Session metadata, including Session identifier, timestamp, duration in seconds, and Overall_Score, for all stored Sessions.
3. WHEN the student selects a past Session from the list, THE Frontend SHALL request the report for that Session from the Backend and SHALL display the report using the same report screen as Requirement 10.
4. IF the requested Session no longer exists in the local data directory, THEN THE Backend SHALL return a not-found response and THE Frontend SHALL display a message stating that the Session is no longer available.
5. WHERE the student clicks a delete control for a Session, THE Backend SHALL remove the Session video, report, and metadata from the local data directory.
6. WHEN the number of stored Sessions exceeds a configured retention limit, THE Backend SHALL delete the oldest Session videos and report files until the count is at or below the limit.

### Requirement 15: Recording Environment Validation

**User Story:** As a student, I want a quick check that my camera setup is usable before recording, so that I do not waste a recording on poor framing or lighting.

#### Acceptance Criteria

1. WHILE the Frontend displays the recording screen and recording has not started, THE Frontend SHALL send sample frames to the Backend at a rate of 1 frame per second for a pre-check.
2. WHEN the Backend receives a pre-check frame, THE Backend SHALL run MediaPipe Pose and MediaPipe Face Mesh on the frame and SHALL return whether a full upper body and a face are detected.
3. THE Frontend SHALL display a readiness indicator that is green when the most recent pre-check frame contained both a full upper body and a face, and amber otherwise.
4. IF the readiness indicator is amber for 5 consecutive pre-check frames, THEN THE Frontend SHALL display guidance text instructing the student to adjust framing, distance, or lighting.
5. WHEN recording starts, THE Frontend SHALL stop sending pre-check frames.
