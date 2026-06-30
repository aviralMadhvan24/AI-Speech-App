# Requirements Document

## Introduction

The Mock Interview MVP is a lean web application that lets students practice
interview answers by recording short videos, and lets teachers review those
videos and provide structured feedback. Each evaluated answer produces a single
overall score (0–100), and students are ranked on one college-wide leaderboard
by their average overall score across evaluated attempts.

This is an intentionally minimal MVP. It deliberately excludes badges,
improvement/consistency analytics, dashboards, notifications, admin question
management, and multiple leaderboard types. The goal is a working end-to-end
flow: register/login → pick question → record & submit video → teacher reviews
& scores → results visible on student profile and leaderboard.

## Glossary

- **System**: The Mock Interview MVP application (frontend + backend) as a whole.
- **Student**: A registered user with the Student role who records and submits video answers.
- **Teacher**: A registered user with the Teacher role who reviews submissions and provides feedback.
- **Auth_Service**: The backend component responsible for registration, login, and role-based access.
- **Question**: One of a fixed, code-seeded set of interview questions a Student can answer.
- **Submission**: A single recorded video answer to a Question by a Student, with a review status.
- **Submission_Status**: The state of a Submission, one of `pending` (awaiting teacher review) or `evaluated` (review completed).
- **Recorder**: The frontend component that captures, previews, and uploads a Student video answer.
- **Video_Store**: The object/file storage that holds uploaded video files.
- **Evaluation**: A Teacher's completed review of a Submission, containing 8 parameter scores and written overall feedback.
- **Parameter_Score**: An integer from 1 to 10 assigned by a Teacher to one of the 8 soft-skill parameters.
- **Soft_Skill_Parameter**: One of the 8 scored attributes: Confidence, Communication Skills, Fluency, Clarity, Vocabulary & Grammar, Body Language, Eye Contact, Professionalism.
- **Overall_Score**: A 0–100 score for a single Submission, computed as the mean of the 8 Parameter_Scores multiplied by 10.
- **Average_Overall_Score**: A Student's mean Overall_Score across all of their evaluated Submissions.
- **Leaderboard**: The single college-wide ranking of Students ordered by Average_Overall_Score.
- **Max_Duration**: The maximum allowed length of a recorded video answer, fixed at 60 seconds.

## Requirements

### Requirement 1: Registration and Roles

**User Story:** As a new user, I want to register and log in with a role, so that I can access the features for either a Student or a Teacher.

#### Acceptance Criteria

1. WHEN a visitor submits a registration form with name, email, password, and a selected role of Student or Teacher, THE Auth_Service SHALL create a user account with that role.
2. IF a visitor submits registration with an email that already belongs to an existing account, THEN THE Auth_Service SHALL reject the registration and return a descriptive error.
3. WHEN a registered user submits valid login credentials, THE Auth_Service SHALL authenticate the user and return a JWT access token containing the user role.
4. IF a user submits invalid login credentials, THEN THE Auth_Service SHALL reject the login and return an authentication error.
5. WHEN a request is made to a protected endpoint without a valid JWT, THE System SHALL reject the request with an unauthorized error.
6. IF a Student requests a Teacher-only action, THEN THE System SHALL reject the request with a forbidden error.

### Requirement 2: Fixed Question List

**User Story:** As a Student, I want to choose from a set of interview questions, so that I can record an answer to a specific prompt.

#### Acceptance Criteria

1. THE System SHALL provide a fixed list of 10 interview Questions seeded in code.
2. WHEN a Student requests the list of Questions, THE System SHALL return all 10 seeded Questions.
3. THE System SHALL NOT expose any interface for creating, editing, or deleting Questions in the MVP.

### Requirement 3: Record and Submit Video Answer

**User Story:** As a Student, I want to record a short video answer and submit it, so that a Teacher can review my interview performance.

#### Acceptance Criteria

1. WHEN a Student selects a Question and starts recording, THE Recorder SHALL capture video from the Student device camera and microphone.
2. WHILE a recording is in progress and the elapsed time reaches Max_Duration, THE Recorder SHALL stop the recording automatically.
3. WHEN a Student finishes recording, THE Recorder SHALL allow the Student to preview the recorded video before submitting.
4. WHEN a Student submits a previewed recording, THE System SHALL store the video file in the Video_Store and create a Submission linked to the Student and the selected Question.
5. WHEN a Submission is created, THE System SHALL set its Submission_Status to `pending`.
6. THE System SHALL retain every submitted Submission as history, allowing a Student to have multiple Submissions over time.

### Requirement 4: Teacher Review and Feedback

**User Story:** As a Teacher, I want to see pending submissions and score them, so that students receive structured feedback on their answers.

#### Acceptance Criteria

1. WHEN a Teacher requests pending submissions, THE System SHALL return all Submissions whose Submission_Status is `pending`.
2. WHEN a Teacher opens a Submission, THE System SHALL provide playback of the stored video for that Submission.
3. WHEN a Teacher submits an Evaluation, THE System SHALL require a Parameter_Score from 1 to 10 for each of the 8 Soft_Skill_Parameters and a written overall feedback text.
4. IF a Teacher submits an Evaluation with a missing Parameter_Score or a Parameter_Score outside the range 1 to 10, THEN THE System SHALL reject the Evaluation and return a validation error.
5. WHEN a Teacher submits a valid Evaluation for a Submission, THE System SHALL store the Evaluation and set the Submission_Status to `evaluated`.

### Requirement 5: Overall Score Calculation

**User Story:** As a Student, I want my answer turned into a single score, so that I can understand my overall performance at a glance.

#### Acceptance Criteria

1. WHEN an Evaluation is stored for a Submission, THE System SHALL compute the Overall_Score as the mean of the 8 Parameter_Scores multiplied by 10.
2. THE System SHALL produce an Overall_Score in the range 0 to 100 inclusive.

### Requirement 6: Viewing Results

**User Story:** As a Student, I want to see my scores and written feedback, so that I can learn how to improve.

#### Acceptance Criteria

1. WHEN a Student views their profile, THE System SHALL display each evaluated Submission with its Overall_Score and written overall feedback.
2. WHEN a Teacher views an evaluated Submission, THE System SHALL display its Overall_Score and written overall feedback.
3. WHILE a Submission has Submission_Status of `pending`, THE System SHALL indicate that the Submission is awaiting review and SHALL NOT display an Overall_Score for that Submission.

### Requirement 7: College-Wide Leaderboard

**User Story:** As a Student, I want to see how I rank against other students, so that I stay motivated to improve.

#### Acceptance Criteria

1. THE System SHALL compute each Student Average_Overall_Score as the mean of the Overall_Scores of that Student evaluated Submissions.
2. WHEN a user requests the Leaderboard, THE System SHALL return all Students who have at least one evaluated Submission, ordered from highest to lowest Average_Overall_Score.
3. WHERE a Student has no evaluated Submissions, THE System SHALL exclude that Student from the Leaderboard.
