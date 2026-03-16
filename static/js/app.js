const LANG_NAMES = {
  en:"English",ta:"Tamil",hi:"Hindi",es:"Spanish",fr:"French",
  de:"German",ja:"Japanese",zh:"Chinese",ar:"Arabic",
  pt:"Portuguese",ko:"Korean",ru:"Russian"
};

const state = {
  jobId: null,
  data: null,
  currentLang: "en",
  chips: { chipSum:true, chipKey:true, chipTime:false },
  activeTab: "notes",
  pollTimer: null,
};

// ── Chips ──
function toggleChip(id) {
  state.chips[id] = !state.chips[id];
  document.getElementById(id).classList.toggle("on", state.chips[id]);
}

// ── Language menu ──
function toggleLangMenu() {
  document.getElementById("langDropdown").classList.toggle("open");
}
document.addEventListener("click", e => {
  if (!e.target.closest("#langBtn") && !e.target.closest("#langDropdown"))
    document.getElementById("langDropdown").classList.remove("open");
});
async function selectLang(el) {
  const lang = el.dataset.lang;
  document.querySelectorAll(".lang-opt").forEach(o => o.classList.remove("active"));
  el.classList.add("active");
  document.getElementById("langLabel").textContent = el.dataset.label;
  document.getElementById("langDropdown").classList.remove("open");
  if (lang === state.currentLang) return;
  state.currentLang = lang;
  await applyLanguage(lang);
}

// ── Tabs ──
function switchTab(tab, el) {
  state.activeTab = tab;
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  el.classList.add("active");
  document.getElementById("notesTab").style.display      = tab === "notes"      ? "block" : "none";
  document.getElementById("keypointsTab").style.display  = tab === "keypoints"  ? "block" : "none";
  document.getElementById("timestampsTab").style.display = tab === "timestamps" ? "block" : "none";
}

// ── Toast ──
function toast(msg, type = "") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast " + type;
  setTimeout(() => el.classList.add("show"), 10);
  setTimeout(() => el.classList.remove("show"), 3200);
}

// ── Show/hide sections ──
function showSection(section) {
  document.getElementById("emptyState").style.display   = section === "empty"   ? "block" : "none";
  document.getElementById("loadingWrap").style.display  = section === "loading" ? "block" : "none";
  document.getElementById("notesWrap").style.display    = section === "notes"   ? "block" : "none";
}
function setError(show, msg = "") {
  const el = document.getElementById("errorCard");
  el.style.display = show ? "flex" : "none";
  if (msg) document.getElementById("errorMsg").textContent = msg;
}

// ── Main: start ──
async function startProcess() {
  const url = document.getElementById("urlInput").value.trim();
  if (!url) { toast("Please enter a YouTube URL", "error"); return; }
  if (!url.includes("youtube.com") && !url.includes("youtu.be")) {
    toast("Please enter a valid YouTube URL", "error"); return;
  }

  // Reset
  state.currentLang = "en";
  document.querySelectorAll(".lang-opt").forEach(o => {
    o.classList.remove("active");
    if (o.dataset.lang === "en") o.classList.add("active");
  });
  document.getElementById("langLabel").textContent = "English";
  setError(false);
  showSection("loading");
  document.getElementById("goBtn").disabled = true;

  try {
    const res = await fetch("/api/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        summarize:  state.chips.chipSum,
        keypoints:  state.chips.chipKey,
        timestamps: state.chips.chipTime,
      }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    state.jobId = json.job_id;
    startPolling();
  } catch (err) {
    setError(true, err.message);
    showSection("empty");
    document.getElementById("goBtn").disabled = false;
  }
}

// ── Polling ──
function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(poll, 1800);
}
async function poll() {
  try {
    const res = await fetch(`/api/status/${state.jobId}`);
    const job = await res.json();
    if (job.error) throw new Error(job.error);

    document.getElementById("loadStep").textContent       = job.step || "Processing…";
    document.getElementById("loadMsg").textContent        = job.msg  || "";
    document.getElementById("progressFill").style.width   = (job.progress || 0) + "%";

    if (job.status === "done") {
      clearInterval(state.pollTimer);
      state.data = job.data;
      renderNotes();
      showSection("notes");
      document.getElementById("goBtn").disabled = false;
    } else if (job.status === "error") {
      clearInterval(state.pollTimer);
      setError(true, job.msg || "Processing failed.");
      showSection("empty");
      document.getElementById("goBtn").disabled = false;
    }
  } catch (err) {
    clearInterval(state.pollTimer);
    setError(true, err.message);
    showSection("empty");
    document.getElementById("goBtn").disabled = false;
  }
}

// ── Render ──
function renderNotes() {
  const d = state.data;
  document.getElementById("notesTitle").textContent = d.title || "Video Notes";
  document.getElementById("notesMeta").textContent  =
    `Transcribed · ${new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})} · ${LANG_NAMES[d.detected_lang] || "Unknown"} detected`;
  document.getElementById("notesContent").textContent = d.transcript || "";

  // Summary
  const sc = document.getElementById("summaryCard");
  if (state.chips.chipSum && d.summary) {
    document.getElementById("summaryText").textContent = d.summary;
    sc.style.display = "block";
  } else {
    sc.style.display = "none";
  }

  // Key points
  if (state.chips.chipKey && d.keypoints?.length) {
    renderKP(d.keypoints);
    document.getElementById("kpTab").style.display = "";
  } else {
    document.getElementById("kpTab").style.display = "none";
  }

  // Timestamps
  if (state.chips.chipTime && d.timestamped) {
    document.getElementById("tsContent").textContent = d.timestamped;
    document.getElementById("tsTab").style.display = "";
  } else {
    document.getElementById("tsTab").style.display = "none";
  }
}

function renderKP(kps) {
  document.getElementById("kpList").innerHTML = kps.map((k, i) => `
    <div class="kp-item">
      <div class="kp-num">${String(i+1).padStart(2,"0")}</div>
      <div>${k}</div>
    </div>`).join("");
}

// ── Translation ──
async function applyLanguage(lang) {
  if (!state.data) return;
  if (lang === "en") {
    document.getElementById("notesContent").textContent = state.data.transcript;
    if (state.data.summary) document.getElementById("summaryText").textContent = state.data.summary;
    if (state.data.keypoints?.length) renderKP(state.data.keypoints);
    updateMeta("English");
    return;
  }

  const bar = document.getElementById("transBar");
  bar.style.display = "flex";
  document.getElementById("transBarText").textContent = `Translating to ${LANG_NAMES[lang]}…`;

  try {
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: state.jobId, lang }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error);

    document.getElementById("notesContent").textContent = json.transcript || "";
    if (json.summary && state.chips.chipSum) document.getElementById("summaryText").textContent = json.summary;
    if (json.keypoints?.length && state.chips.chipKey) renderKP(json.keypoints);
    updateMeta(LANG_NAMES[lang]);
    toast(`Translated to ${LANG_NAMES[lang]}`, "success");
  } catch (err) {
    toast("Translation failed: " + err.message, "error");
  } finally {
    bar.style.display = "none";
  }
}

function updateMeta(langName) {
  document.getElementById("notesMeta").textContent =
    `Transcribed · ${new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})} · ${langName}`;
}

// ── PDF ──
function downloadPDF() {
  if (!state.data) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"mm", format:"a4" });

  const title   = state.data.title || "Video Notes";
  const notes   = document.getElementById("notesContent").textContent;
  const summary = document.getElementById("summaryText").textContent;
  const kpItems = [...document.querySelectorAll(".kp-item")].map(el => el.querySelector("div:last-child").textContent);
  const lang    = LANG_NAMES[state.currentLang] || "English";

  // Header
  doc.setFillColor(108,99,255); doc.rect(0,0,210,27,"F");
  doc.setTextColor(255,255,255); doc.setFontSize(17); doc.setFont(undefined,"bold");
  doc.text("TubeNotes", 14, 11);
  doc.setFontSize(8); doc.setFont(undefined,"normal");
  doc.text(`Generated ${new Date().toLocaleDateString()} · ${lang}`, 14, 20);

  let y = 35;
  // Title
  doc.setTextColor(20,20,30); doc.setFontSize(13); doc.setFont(undefined,"bold");
  const tLines = doc.splitTextToSize(title, 182);
  doc.text(tLines, 14, y); y += tLines.length * 7 + 5;

  // Summary
  if (summary && state.chips.chipSum) {
    doc.setFontSize(8); doc.setTextColor(108,99,255); doc.setFont(undefined,"bold");
    doc.text("SUMMARY", 14, y); y += 5;
    doc.setFontSize(9.5); doc.setTextColor(50,50,70); doc.setFont(undefined,"normal");
    const sLines = doc.splitTextToSize(summary, 182);
    doc.text(sLines, 14, y); y += sLines.length * 5.5 + 7;
  }

  // Key points
  if (kpItems.length && state.chips.chipKey) {
    doc.setFontSize(8); doc.setTextColor(108,99,255); doc.setFont(undefined,"bold");
    doc.text("KEY POINTS", 14, y); y += 5;
    kpItems.forEach((kp, i) => {
      if (y > 272) { doc.addPage(); y = 18; }
      doc.setFontSize(9.5); doc.setTextColor(50,50,70); doc.setFont(undefined,"normal");
      const kLines = doc.splitTextToSize(`${i+1}. ${kp}`, 176);
      doc.text(kLines, 18, y); y += kLines.length * 5.5 + 2;
    });
    y += 4;
  }

  // Transcript
  if (y > 255) { doc.addPage(); y = 18; }
  doc.setFontSize(8); doc.setTextColor(108,99,255); doc.setFont(undefined,"bold");
  doc.text("FULL TRANSCRIPT", 14, y); y += 5;
  doc.setFontSize(9); doc.setTextColor(50,50,70); doc.setFont(undefined,"normal");
  doc.splitTextToSize(notes, 182).forEach(line => {
    if (y > 280) { doc.addPage(); y = 18; }
    doc.text(line, 14, y); y += 5;
  });

  doc.save(`tubenotes-${Date.now()}.pdf`);
  toast("PDF downloaded!", "success");
}

// ── Copy ──
function copyText() {
  const title   = document.getElementById("notesTitle").textContent;
  const summary = document.getElementById("summaryText").textContent;
  const notes   = document.getElementById("notesContent").textContent;
  let text = `${title}\n\n`;
  if (summary && state.chips.chipSum) text += `SUMMARY\n${summary}\n\n`;
  text += `TRANSCRIPT\n${notes}`;
  navigator.clipboard.writeText(text)
    .then(() => toast("Copied!", "success"))
    .catch(() => toast("Copy failed", "error"));
}

// ── Enter key ──
document.getElementById("urlInput").addEventListener("keydown", e => {
  if (e.key === "Enter") startProcess();
});
