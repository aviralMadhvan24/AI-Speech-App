const promptSelect = document.querySelector("#promptSelect");
const expectedText = document.querySelector("#expectedText");
const focusWord = document.querySelector("#focusWord");
const difficulty = document.querySelector("#difficulty");
const hint = document.querySelector("#hint");
const audioFile = document.querySelector("#audioFile");
const previewAudio = document.querySelector("#previewAudio");
const recordButton = document.querySelector("#recordButton");
const stopButton = document.querySelector("#stopButton");
const analyzeButton = document.querySelector("#analyzeButton");
const statusText = document.querySelector("#statusText");
const pronunciationScore = document.querySelector("#pronunciationScore");
const clarityScore = document.querySelector("#clarityScore");
const paceScore = document.querySelector("#paceScore");
const transcriptText = document.querySelector("#transcriptText");
const mistakesList = document.querySelector("#mistakesList");
const wordsList = document.querySelector("#wordsList");
const waveCanvas = document.querySelector("#waveCanvas");
const modeButtons = document.querySelectorAll(".mode-button");

let prompts = [];
let selectedMode = "battle";
let recordedBlob = null;
let mediaRecorder = null;
let recordedChunks = [];

function setStatus(message) {
  statusText.textContent = message;
}

function formatScore(value, suffix = "") {
  if (value === null || value === undefined) {
    return "--";
  }

  return `${Math.round(value)}${suffix}`;
}

function updatePromptMeta(prompt) {
  expectedText.value = prompt.text;
  focusWord.textContent = prompt.focus_word;
  difficulty.textContent = prompt.difficulty;
  hint.textContent = prompt.hint;
}

async function loadPrompts() {
  const response = await fetch("/battle/prompts");
  prompts = await response.json();

  promptSelect.innerHTML = "";

  prompts.forEach((prompt) => {
    const option = document.createElement("option");
    option.value = prompt.id;
    option.textContent = prompt.text;
    promptSelect.appendChild(option);
  });

  if (prompts.length) {
    updatePromptMeta(prompts[0]);
  }
}

function setMode(mode) {
  selectedMode = mode;
  document.body.classList.toggle("live-mode", mode === "live");

  modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
}

function getSelectedAudio() {
  if (recordedBlob) {
    return {
      blob: recordedBlob,
      filename: "recording.webm"
    };
  }

  if (audioFile.files.length) {
    return {
      blob: audioFile.files[0],
      filename: audioFile.files[0].name
    };
  }

  return null;
}

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  recordedChunks = [];
  mediaRecorder = new MediaRecorder(stream);

  mediaRecorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  });

  mediaRecorder.addEventListener("stop", () => {
    recordedBlob = new Blob(recordedChunks, { type: "audio/webm" });
    previewAudio.src = URL.createObjectURL(recordedBlob);
    stream.getTracks().forEach((track) => track.stop());
    setStatus("Recording ready");
  });

  mediaRecorder.start();
  recordButton.disabled = true;
  stopButton.disabled = false;
  setStatus("Recording");
}

function stopRecording() {
  if (!mediaRecorder) {
    return;
  }

  mediaRecorder.stop();
  recordButton.disabled = false;
  stopButton.disabled = true;
}

async function analyzeAudio() {
  const audio = getSelectedAudio();

  if (!audio) {
    setStatus("Choose or record audio");
    return;
  }

  const formData = new FormData();
  formData.append("file", audio.blob, audio.filename);

  if (selectedMode === "battle" && expectedText.value.trim()) {
    formData.append("expected_text", expectedText.value.trim());
  }

  setStatus("Analyzing");
  analyzeButton.disabled = true;

  try {
    const response = await fetch("/analyze", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Analysis failed");
    }

    const result = await response.json();
    renderResult(result);
    setStatus("Complete");
  } catch (error) {
    setStatus(error.message);
  } finally {
    analyzeButton.disabled = false;
  }
}

function renderResult(result) {
  pronunciationScore.textContent = formatScore(result.pronunciation_score, "%");
  clarityScore.textContent = formatScore(result.clarity_score, "%");
  paceScore.textContent = formatScore(result.pace_wpm);
  transcriptText.textContent = result.transcript || "No transcript returned.";

  mistakesList.innerHTML = "";
  wordsList.innerHTML = "";

  if (!result.mistakes.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No mistakes found.";
    mistakesList.appendChild(empty);
  }

  result.mistakes.forEach((mistake) => {
    const item = document.createElement("div");
    item.className = "mistake-item";
    item.innerHTML = `
      <div>
        <strong>${mistake.expected_word} -> ${mistake.heard_word || "missing"}</strong>
        <p>${mistake.feedback}</p>
      </div>
      <span class="pill">Check</span>
    `;
    mistakesList.appendChild(item);
  });

  result.words.forEach((word) => {
    const item = document.createElement("div");
    item.className = "word-item";
    item.innerHTML = `
      <div>
        <strong>${word.word}</strong>
        <span>${word.start.toFixed(2)}s - ${word.end.toFixed(2)}s</span>
      </div>
      <span class="pill">${Math.round(word.probability * 100)}%</span>
    `;
    wordsList.appendChild(item);
  });
}

function drawWave() {
  const context = waveCanvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const width = waveCanvas.clientWidth;
  const height = waveCanvas.clientHeight;

  waveCanvas.width = width * ratio;
  waveCanvas.height = height * ratio;
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);

  const bars = 82;
  const gap = 5;
  const barWidth = Math.max(3, (width - bars * gap) / bars);
  const time = Date.now() / 420;

  for (let index = 0; index < bars; index += 1) {
    const wave = Math.sin(index * 0.34 + time) * 0.5 + 0.5;
    const pulse = Math.sin(index * 0.11 - time * 0.75) * 0.5 + 0.5;
    const barHeight = 18 + wave * 74 + pulse * 34;
    const x = index * (barWidth + gap);
    const y = (height - barHeight) / 2;

    context.fillStyle = index % 3 === 0 ? "#37c5a0" : index % 3 === 1 ? "#f1b44b" : "#e7685d";
    context.fillRect(x, y, barWidth, barHeight);
  }

  requestAnimationFrame(drawWave);
}

promptSelect.addEventListener("change", () => {
  const prompt = prompts.find((item) => item.id === promptSelect.value);

  if (prompt) {
    updatePromptMeta(prompt);
  }
});

audioFile.addEventListener("change", () => {
  recordedBlob = null;

  if (audioFile.files.length) {
    previewAudio.src = URL.createObjectURL(audioFile.files[0]);
    setStatus("File ready");
  }
});

recordButton.addEventListener("click", startRecording);
stopButton.addEventListener("click", stopRecording);
analyzeButton.addEventListener("click", analyzeAudio);

modeButtons.forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

loadPrompts().catch((error) => setStatus(error.message));
drawWave();
