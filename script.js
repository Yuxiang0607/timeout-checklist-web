// ===== 後端位置（改成你的 Render 網址）=====
const API_BASE = "https://timeout-checklist-server.onrender.com";
const CHUNK_MS = 2250; // 與後端邏輯一致

// ===== Checklist（視覺分組）=====
const groups = [
  { title: "Timeout Initiation", items: [
    "Is everyone ready to begin the timeout?",
    "Do we have the consent form in front of us?"
  ]},
  { title: "Team Introduction", items: [
    "Please introduce yourselves.",
    "Is the attending physician present?",
    "Who is the anesthesia attending?",
    "What are the names and roles of the other team members?"
  ]},
  { title: "Patient Identification", items: [
    "What is your full name?",
    "What is your date of birth?",
    "What is your Medical Record Number?"
  ]},
  { title: "Surgical Consent Verification", items: [
    "Is the consent form signed?",
    "What surgery and/or block is being performed?",
    "Which side?",
    "Is it marked?"
  ]},
  { title: "Local Anesthetic Plan", items: [
    "Which local anesthetic will be used?",
    "What is the intended concentration?",
    "What is the intended volume?"
  ]},
  { title: "Patient Medical Considerations", items: [
    "Are you currently taking any anticoagulants?",
    "Do you have any clotting disorders?",
    "Do you have any known drug allergies?",
    "Do you have a history of systemic neuropathy and/or neuropathy at the surgical site?"
  ]},
  { title: "Monitoring System Check", items: [
    "Is NIBP monitoring ready?",
    "Is ECG monitoring ready?",
    "Is SpO₂ ready?",
    "Is EtCO₂ monitoring ready?"
  ]},
  { title: "Additional Concerns", items: [
    "Does anyone have any other question or concern?"
  ]},
  { title: "Timeout Completion", items: [
    "Timeout completed."
  ]}
];

// ===== Render UI =====
const checklistDiv = document.getElementById('checklist');
function renderChecklist() {
  checklistDiv.innerHTML = "";
  groups.forEach(g => {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'group';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'group-title';
    titleDiv.textContent = g.title;
    groupDiv.appendChild(titleDiv);

    const list = document.createElement('div');
    list.className = 'item-list';

    g.items.forEach(txt => {
      const row = document.createElement('div');
      row.className = 'item-row';
      row.dataset.key = txt;

      const span = document.createElement('span');
      span.className = 'item-text';
      span.textContent = txt;

      const dot = document.createElement('span');
      dot.className = 'red-dot';

      row.appendChild(span);
      row.appendChild(dot);
      list.appendChild(row);
    });

    groupDiv.appendChild(list);
    checklistDiv.appendChild(groupDiv);
  });
}
renderChecklist();

// ===== Buttons / Recording =====
const startBtn = document.getElementById('startBtn');
const stopBtn  = document.getElementById('stopBtn');
const downloadLink = document.getElementById('downloadLink');

let mediaRecorder, audioChunks = [];
let listening = false;
const greened = new Set();

async function postChunk(blob) {
  const fd = new FormData();
  fd.append("audio", blob, "chunk.webm");
  const res = await fetch(`${API_BASE}/transcribe-chunk`, { method: "POST", body: fd });
  if (!res.ok) return;
  const data = await res.json(); // {hits, raw, suggestions}

  (data.hits || []).forEach(sentence => {
    if (greened.has(sentence)) return;
    const row = document.querySelector(`.item-row[data-key="${CSS.escape(sentence)}"]`);
    if (row) {
      row.querySelector('.red-dot').classList.add('green-dot');
      greened.add(sentence);
      if (sentence === "Timeout completed.") stopFlow();
    }
  });
}

async function startFlow() {
  greened.clear();
  document.querySelectorAll('.red-dot').forEach(d => d.classList.remove('green-dot'));
  downloadLink.style.display = "none";
  audioChunks = [];

  if (!navigator.mediaDevices?.getUserMedia) {
    alert("Your browser does not support audio recording.");
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  // 注意：有些瀏覽器需指定 mimeType；若 Safari 失敗可改成 audio/mp4
  mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data?.size > 0) {
      audioChunks.push(e.data);            // 累積整段，給下載連結
      postChunk(e.data).catch(() => {});   // 即時送後端
    }
  };
  mediaRecorder.onstop = () => {
    const blob = new Blob(audioChunks, { type: "audio/webm" });
    const url = URL.createObjectURL(blob);
    downloadLink.href = url;
    downloadLink.style.display = "inline-block";
  };

  listening = true;
  startBtn.disabled = true;
  stopBtn.style.display = "";
  startBtn.textContent = "🎙️ Recognizing...";
  mediaRecorder.start(CHUNK_MS);           // 每 2.25 秒觸發一次 ondataavailable
}

function stopFlow() {
  if (!listening) return;
  listening = false;
  try { mediaRecorder?.stop(); } catch {}
  startBtn.disabled = false;
  stopBtn.style.display = "none";
  startBtn.textContent = "🎤 Start Recognition";
}

startBtn.onclick = startFlow;
stopBtn.onclick  = stopFlow;
