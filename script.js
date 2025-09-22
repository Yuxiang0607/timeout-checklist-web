// ====== 配置 ======
const API_BASE = "https://timeout-checklist-server.onrender.com"; // ← 換成你的
const CHUNK_MS = 2250; // 與後端設計相配

// ====== 從後端拿 canonical（避免前後端清單不同步）======
let allSentences = [];
let groups = [
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

// 畫面渲染
const checklistDiv = document.getElementById('checklist');
function renderChecklist() {
  checklistDiv.innerHTML = "";
  groups.forEach((g, gi) => {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'group';
    const title = document.createElement('div');
    title.className = 'group-title';
    title.textContent = g.title;
    groupDiv.appendChild(title);

    const list = document.createElement('div');
    list.className = 'item-list';
    g.items.forEach((txt, ii) => {
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

  allSentences = groups.flatMap(g => g.items);
}
renderChecklist();

// ====== 控制錄音 ======
const startBtn = document.getElementById('startBtn');
const stopBtn  = document.getElementById('stopBtn');
const downloadLink = document.getElementById('downloadLink');

let mediaRecorder, audioChunks = [];
let listening = false;
let greened = new Set();

async function postChunk(blob) {
  const fd = new FormData();
  fd.append("audio", blob, "chunk.webm");
  const res = await fetch(`${API_BASE}/transcribe-chunk`, { method: "POST", body: fd });
  if (!res.ok) return;

  const data = await res.json(); // {hits:[], raw:[], suggestions:[]}
  (data.hits || []).forEach(sentence => {
    // 去重：同一句只點一次
    if (greened.has(sentence)) return;
    const row = document.querySelector(`.item-row[data-key="${CSS.escape(sentence)}"]`);
    if (row) {
      row.querySelector('.red-dot').classList.add('green-dot');
      greened.add(sentence);
      // 自動收尾：若命中 "Timeout completed." 就停
      if (sentence === "Timeout completed.") stopFlow();
    }
  });
}

async function startFlow() {
  // reset UI
  greened.clear();
  document.querySelectorAll('.red-dot').forEach(d=>d.classList.remove('green-dot'));
  downloadLink.style.display = "none";
  audioChunks = [];

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("Your browser does not support audio recording.");
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      audioChunks.push(e.data);          // 做下載用
      postChunk(e.data).catch(()=>{});   // 丟給後端辨識
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

  // 每 CHUNK_MS 丟一塊（與後端預期一致）
  mediaRecorder.start(CHUNK_MS);
}

function stopFlow() {
  if (!listening) return;
  listening = false;
  try { mediaRecorder && mediaRecorder.stop(); } catch {}
  startBtn.disabled = false;
  stopBtn.style.display = "none";
  startBtn.textContent = "🎤 Start Recognition";
}

startBtn.onclick = () => startFlow();
stopBtn.onclick  = () => stopFlow();
