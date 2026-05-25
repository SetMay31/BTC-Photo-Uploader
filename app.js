// BTC Photo Uploader — main app
// Static client-side app. Talks directly to Google Drive + Sheets via OAuth.
// All survey/folder/photo config lives in config.js.

(function () {
  "use strict";

  const { OAUTH_CLIENT_ID, TEAM_MEMBERS, SURVEYS } = window.BTC_CONFIG;

  // Scopes: drive.file restricts the app to files/folders it creates OR the user
  // explicitly opens. Since our root folders pre-exist, we also need full drive
  // scope to find children + upload into existing folders we don't own.
  // spreadsheets is needed to create + append rows to the citizen science master sheet.
  const OAUTH_SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
  ].join(" ");

  const state = {
    accessToken: null,
    tokenClient: null,
    currentSurvey: null,
    folderValues: {},
    masterSheetValues: {},
    photos: [], // { id, file, jpegBlob, thumbUrl, values, status, error, driveId }
    uploading: false,
    photoIdSeq: 0,
    previewMode: false,
  };

  // ---------- DOM helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of children) {
      if (c == null || c === false) continue;
      e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return e;
  }

  // ---------- Filename safety ----------
  // Convert spaces inside a field value to underscores so dash remains the field separator.
  function safeField(s) {
    if (s == null) return "";
    return String(s).trim().replace(/\s+/g, "_").replace(/[\/\\:*?"<>|]/g, "");
  }

  // Render a template like "{a}-{b}[-{c}]" with values. Bracketed segments
  // are dropped entirely when any referenced field is empty.
  function renderTemplate(template, values) {
    return template.replace(/\[([^\[\]]+)\]|\{([^{}|]+)(?:\|([^{}]+))?\}/g, (match, optional, key, filter) => {
      if (optional !== undefined) {
        // Optional segment — drop if any {key} inside resolves to empty.
        const innerKeys = [...optional.matchAll(/\{([^{}|]+)(?:\|[^{}]+)?\}/g)].map((m) => m[1]);
        const hasEmpty = innerKeys.some((k) => !values[k] || String(values[k]).trim() === "");
        if (hasEmpty) return "";
        return renderTemplate(optional, values);
      }
      const raw = values[key];
      if (raw == null || String(raw).trim() === "") return "";
      let v = safeField(raw);
      if (filter === "initial") v = v.charAt(0).toUpperCase();
      return v;
    });
  }

  // ---------- Theme ----------
  function applyTheme(theme) {
    const root = document.documentElement;
    root.style.setProperty("--accent", theme.accent);
    root.style.setProperty("--accent-2", theme.accent2);
    root.style.setProperty("--accent-soft", theme.accentSoft);
    root.style.setProperty("--brand-vivid", theme.brandVivid);
    root.style.setProperty("--accent-shadow", theme.shadow);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme.accent);
  }

  // ---------- Survey toggle ----------
  function renderSurveyToggle() {
    const nav = $("#survey-toggle");
    nav.innerHTML = "";
    SURVEYS.forEach((survey) => {
      const btn = el("button", {
        class: "survey-pill",
        type: "button",
        "data-key": survey.key,
        onclick: () => selectSurvey(survey.key),
      }, survey.label);
      nav.appendChild(btn);
    });
  }

  function selectSurvey(key) {
    const survey = SURVEYS.find((s) => s.key === key);
    if (!survey) return;
    state.currentSurvey = survey;
    state.folderValues = {};
    state.masterSheetValues = {};
    state.photos.forEach((p) => URL.revokeObjectURL(p.thumbUrl));
    state.photos = [];
    applyTheme(survey.theme);
    $$(".survey-pill").forEach((b) => b.classList.toggle("active", b.dataset.key === key));
    $("#survey-heading").textContent = survey.label;
    renderFolderForm();
    renderMasterSheetForm();
    renderPhotoList();
    updateFolderPreview();
    updateUploadButton();
    $("#upload-result").className = "submit-result";
    $("#upload-result").textContent = "";
  }

  // ---------- Field rendering ----------
  // Builds a labelled input that updates the given `values` object on change,
  // and re-renders downstream UI (folder preview / filenames / upload state).
  function renderField(field, values, opts = {}) {
    const labelEl = el("label", {});
    const labelText = field.label + (field.required ? " *" : "");
    labelEl.appendChild(document.createTextNode(labelText));

    const onChange = opts.onChange || (() => {});

    if (field.type === "date") {
      const input = el("input", { type: "date", name: field.name });
      // Default today if uninitialised (Survey Date / Date fields).
      if (!values[field.name]) {
        const today = new Date().toISOString().slice(0, 10);
        values[field.name] = today;
        input.value = today;
      } else {
        input.value = values[field.name];
      }
      input.addEventListener("input", () => { values[field.name] = input.value; onChange(); });
      labelEl.appendChild(input);
    } else if (field.type === "time") {
      const input = el("input", { type: "time", name: field.name });
      if (values[field.name]) input.value = values[field.name];
      input.addEventListener("input", () => { values[field.name] = input.value; onChange(); });
      labelEl.appendChild(input);
    } else if (field.type === "number") {
      const input = el("input", { type: "number", name: field.name, min: field.min, step: field.step || 1, inputmode: "numeric" });
      if (values[field.name] != null) input.value = values[field.name];
      input.addEventListener("input", () => { values[field.name] = input.value; onChange(); });
      labelEl.appendChild(input);
    } else if (field.type === "textarea") {
      const ta = el("textarea", { name: field.name, placeholder: field.placeholder || "", rows: 3 });
      if (values[field.name]) ta.value = values[field.name];
      ta.addEventListener("input", () => { values[field.name] = ta.value; onChange(); });
      labelEl.appendChild(ta);
    } else if (field.type === "team-or-other") {
      const selectEl = el("select", { name: field.name });
      selectEl.appendChild(el("option", { value: "" }, "— Choose —"));
      TEAM_MEMBERS.forEach((m) => selectEl.appendChild(el("option", { value: m }, m)));
      selectEl.appendChild(el("option", { value: "__other__" }, "Other (please specify)"));
      const otherInput = el("input", { type: "text", class: "other-specify", placeholder: "Please specify" });
      otherInput.style.display = "none";

      const currentVal = values[field.name];
      if (currentVal && TEAM_MEMBERS.includes(currentVal)) {
        selectEl.value = currentVal;
      } else if (currentVal) {
        selectEl.value = "__other__";
        otherInput.value = currentVal;
        otherInput.style.display = "";
      }

      selectEl.addEventListener("change", () => {
        if (selectEl.value === "__other__") {
          otherInput.style.display = "";
          values[field.name] = otherInput.value || "";
        } else {
          otherInput.style.display = "none";
          values[field.name] = selectEl.value;
        }
        onChange();
      });
      otherInput.addEventListener("input", () => {
        if (selectEl.value === "__other__") values[field.name] = otherInput.value;
        onChange();
      });
      labelEl.appendChild(selectEl);
      labelEl.appendChild(otherInput);
    } else if (field.type === "select-or-other") {
      const selectEl = el("select", { name: field.name });
      selectEl.appendChild(el("option", { value: "" }, "— Choose —"));
      field.options.forEach((o) => selectEl.appendChild(el("option", { value: o }, o)));
      selectEl.appendChild(el("option", { value: "__other__" }, "Other (please specify)"));
      const otherInput = el("input", { type: "text", class: "other-specify", placeholder: "Please specify" });
      otherInput.style.display = "none";

      const currentVal = values[field.name];
      if (currentVal && field.options.includes(currentVal)) {
        selectEl.value = currentVal;
      } else if (currentVal) {
        selectEl.value = "__other__";
        otherInput.value = currentVal;
        otherInput.style.display = "";
      }

      selectEl.addEventListener("change", () => {
        if (selectEl.value === "__other__") {
          otherInput.style.display = "";
          values[field.name] = otherInput.value || "";
        } else {
          otherInput.style.display = "none";
          values[field.name] = selectEl.value;
        }
        onChange();
      });
      otherInput.addEventListener("input", () => {
        if (selectEl.value === "__other__") values[field.name] = otherInput.value;
        onChange();
      });
      labelEl.appendChild(selectEl);
      labelEl.appendChild(otherInput);
    } else {
      // Default: text (incl. auto-increment-text which behaves identically — autofill is handled by caller).
      const input = el("input", { type: "text", name: field.name, placeholder: field.placeholder || "" });
      if (values[field.name] != null) input.value = values[field.name];
      input.addEventListener("input", () => { values[field.name] = input.value; onChange(); });
      labelEl.appendChild(input);
    }
    return labelEl;
  }

  // ---------- Folder form ----------
  function renderFolderForm() {
    const form = $("#folder-form");
    form.innerHTML = "";
    const survey = state.currentSurvey;
    if (!survey) return;
    survey.folder.fields.forEach((f) => {
      const node = renderField(f, state.folderValues, {
        onChange: () => {
          updateFolderPreview();
          updateUploadButton();
        },
      });
      form.appendChild(node);
    });
  }

  function renderMasterSheetForm() {
    const heading = $("#master-sheet-heading");
    const form = $("#master-sheet-form");
    form.innerHTML = "";
    const survey = state.currentSurvey;
    if (!survey || !survey.masterSheet) {
      heading.classList.add("hidden");
      form.classList.add("hidden");
      return;
    }
    heading.classList.remove("hidden");
    form.classList.remove("hidden");
    survey.masterSheet.fields.forEach((f) => {
      form.appendChild(renderField(f, state.masterSheetValues, {
        onChange: updateUploadButton,
      }));
    });
  }

  function getFolderName() {
    const survey = state.currentSurvey;
    if (!survey) return "";
    return renderTemplate(survey.folder.template, state.folderValues);
  }

  function updateFolderPreview() {
    const el = $("#folder-preview");
    const name = getFolderName();
    if (!name) {
      el.textContent = "Folder name preview — fill in folder details above";
      el.classList.add("empty");
    } else {
      el.textContent = `📁 ${name}`;
      el.classList.remove("empty");
    }
    state.photos.forEach((p) => updatePhotoPreview(p));
  }

  // ---------- Photo handling ----------
  function newPhotoId() { return ++state.photoIdSeq; }

  async function addFiles(fileList) {
    const survey = state.currentSurvey;
    if (!survey) return;
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/") || /\.heic$/i.test(f.name));
    for (const file of files) {
      const photo = {
        id: newPhotoId(),
        file,
        jpegBlob: null,
        thumbUrl: URL.createObjectURL(file),
        values: {},
        status: "pending",
        error: null,
        driveId: null,
      };
      // Initialise per-photo defaults (sequence numbers + auto-increment helpers).
      initPhotoDefaults(photo);
      state.photos.push(photo);
    }
    renderPhotoList();
    updateUploadButton();
  }

  function initPhotoDefaults(photo) {
    const survey = state.currentSurvey;
    const seq = survey.photo.sequence;
    if (seq) {
      // Folder-continuation count is fetched at upload time. Locally we still
      // number 1, 2, 3 within the current session so previews look right —
      // the offset is applied on upload.
      const sessionIndex = state.photos.filter((p) => p.id !== photo.id).length + 1;
      photo.values[seq.field] = String(sessionIndex);
    }
    // Sea Slug auto-increment-text — pre-fill previous + 1 for editable boxes.
    const autoInc = survey.photo.fields.find((f) => f.type === "auto-increment-text");
    if (autoInc) {
      const prev = state.photos[state.photos.length - 1];
      if (prev && prev.values[autoInc.name] != null && prev.values[autoInc.name] !== "") {
        const n = parseInt(prev.values[autoInc.name], 10);
        if (!isNaN(n)) photo.values[autoInc.name] = String(n + 1);
      }
    }
  }

  function renderPhotoList() {
    const wrap = $("#photo-list");
    wrap.innerHTML = "";
    const survey = state.currentSurvey;
    if (!survey) return;
    state.photos.forEach((photo, idx) => {
      const tpl = $("#tpl-photo-row").content.cloneNode(true);
      const row = tpl.querySelector(".photo-row");
      row.dataset.id = photo.id;
      const thumb = tpl.querySelector(".photo-thumb");
      thumb.src = photo.thumbUrl;
      tpl.querySelector(".photo-original-name").textContent = photo.file.name;
      const previewEl = tpl.querySelector(".photo-preview-name");
      previewEl.textContent = "";
      photo._previewEl = previewEl;
      photo._rowEl = row;
      photo._errorEl = tpl.querySelector(".photo-error");

      tpl.querySelector(".photo-remove").addEventListener("click", (e) => {
        e.stopPropagation();
        URL.revokeObjectURL(photo.thumbUrl);
        state.photos = state.photos.filter((p) => p.id !== photo.id);
        renumberSequence();
        renderPhotoList();
        updateUploadButton();
      });

      const collapseBtn = tpl.querySelector(".photo-collapse");
      const head = tpl.querySelector(".photo-row-head");
      const toggleCollapse = (e) => {
        if (e) e.stopPropagation();
        row.classList.toggle("collapsed");
        const expanded = !row.classList.contains("collapsed");
        photo._collapsed = !expanded;
        collapseBtn.setAttribute("aria-expanded", String(expanded));
        collapseBtn.setAttribute("aria-label", expanded ? "Collapse" : "Expand");
      };
      collapseBtn.addEventListener("click", toggleCollapse);
      head.addEventListener("click", toggleCollapse);
      // Restore prior collapsed state (so re-renders don't expand everything).
      if (photo._collapsed) {
        row.classList.add("collapsed");
        collapseBtn.setAttribute("aria-expanded", "false");
        collapseBtn.setAttribute("aria-label", "Expand");
      }

      const fieldsWrap = tpl.querySelector(".photo-row-fields");
      // Sequence number — auto-assigned, but user can override manually.
      if (survey.photo.sequence) {
        const seqField = survey.photo.sequence.field;
        const seqLabel = el("label", {}, seqField === "turtleNumber" ? "Turtle #" : "#");
        const seqInput = el("input", {
          type: "text",
          inputmode: "numeric",
          value: photo.values[seqField] || "",
        });
        seqInput.style.maxWidth = "80px";
        seqInput.addEventListener("input", () => {
          photo.values[seqField] = seqInput.value;
          photo._seqOverridden = true;
          updatePhotoPreview(photo);
          updateUploadButton();
        });
        photo._seqInputEl = seqInput;
        seqLabel.appendChild(seqInput);
        fieldsWrap.appendChild(seqLabel);
      }
      survey.photo.fields.forEach((f) => {
        const node = renderField(f, photo.values, {
          onChange: () => {
            updatePhotoPreview(photo);
            updateUploadButton();
          },
        });
        fieldsWrap.appendChild(node);
      });

      wrap.appendChild(tpl);
      updatePhotoPreview(photo);
    });
    $("#photo-count").textContent = `${state.photos.length} photo${state.photos.length === 1 ? "" : "s"}`;
  }

  function renumberSequence() {
    const survey = state.currentSurvey;
    if (!survey || !survey.photo.sequence) return;
    state.photos.forEach((p, i) => {
      if (p._seqOverridden) return; // preserve user-set values
      p.values[survey.photo.sequence.field] = String(i + 1);
    });
  }

  function getPhotoFilename(photo) {
    const survey = state.currentSurvey;
    const base = renderTemplate(survey.photo.template, photo.values);
    const ext = photo.file.name.match(/\.[^.]+$/);
    let extStr = ext ? ext[0] : "";
    if (/\.heic$/i.test(extStr)) extStr = ".jpg";
    return base + extStr;
  }

  function updatePhotoPreview(photo) {
    if (!photo._previewEl) return;
    const name = getPhotoFilename(photo);
    photo._previewEl.textContent = name ? `→ ${name}` : "";
  }

  function updateUploadButton() {
    const btn = $("#upload-btn");
    const ok = canUpload();
    btn.disabled = !ok || state.uploading;
    if (state.uploading) {
      btn.textContent = "Uploading…";
    } else if (state.previewMode) {
      btn.textContent = "Sign in to upload";
    } else {
      btn.textContent = `Upload ${state.photos.length} photo${state.photos.length === 1 ? "" : "s"}`;
    }
  }

  function canUpload() {
    const survey = state.currentSurvey;
    if (!survey) return false;
    if (state.previewMode || !state.accessToken) return false;
    if (state.photos.length === 0) return false;
    // Folder fields valid?
    for (const f of survey.folder.fields) {
      if (f.required && !state.folderValues[f.name]) return false;
    }
    // Per-photo required fields valid?
    for (const photo of state.photos) {
      for (const f of survey.photo.fields) {
        if (f.required && !photo.values[f.name]) return false;
      }
    }
    return true;
  }

  // ---------- Drag & drop ----------
  function bindDropArea() {
    const drop = $("#drop-area");
    const input = $("#file-input");
    drop.addEventListener("click", () => input.click());
    input.addEventListener("change", (e) => {
      if (e.target.files && e.target.files.length) addFiles(e.target.files);
      input.value = "";
    });
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("drag-over");
    }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove("drag-over");
    }));
    drop.addEventListener("drop", (e) => {
      if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });
  }

  // ---------- OAuth ----------
  function initAuth() {
    if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) return;
    state.tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: OAUTH_CLIENT_ID,
      scope: OAUTH_SCOPES,
      callback: (resp) => {
        if (resp && resp.access_token) {
          state.accessToken = resp.access_token;
          $("#auth-prompt").classList.add("hidden");
          $("#uploader").classList.remove("hidden");
          $("#auth-btn").textContent = "Signed in";
          $("#auth-error").textContent = "";
          if (state.previewMode) exitPreviewMode();
          if (!state.currentSurvey) selectSurvey(SURVEYS[0].key);
          updateUploadButton();
        } else if (resp && resp.error) {
          $("#auth-error").textContent = `Sign-in failed: ${resp.error_description || resp.error}`;
        }
      },
    });
  }

  function requestSignIn() {
    if (OAUTH_CLIENT_ID.startsWith("REPLACE_WITH_YOUR_CLIENT_ID")) {
      $("#auth-error").textContent = "Configure OAUTH_CLIENT_ID in config.js first (see README).";
      return;
    }
    if (!state.tokenClient) initAuth();
    if (!state.tokenClient) {
      $("#auth-error").textContent = "Google sign-in library hasn't loaded yet — please wait a moment and try again.";
      return;
    }
    state.tokenClient.requestAccessToken({ prompt: state.accessToken ? "" : "consent" });
  }

  // ---------- Google APIs ----------
  function gapi(path, opts = {}) {
    const url = path.startsWith("http") ? path : `https://www.googleapis.com${path}`;
    const headers = Object.assign({}, opts.headers || {}, {
      Authorization: `Bearer ${state.accessToken}`,
    });
    return fetch(url, Object.assign({}, opts, { headers }));
  }

  async function findFolderByName(parentId, name) {
    const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and trashed=false and name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents`);
    const resp = await gapi(`/drive/v3/files?q=${q}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`);
    if (!resp.ok) throw new Error("Drive folder lookup failed: " + resp.status);
    const json = await resp.json();
    return (json.files && json.files[0]) || null;
  }

  async function countPhotosInFolder(folderId) {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false and mimeType contains 'image/'`);
    const resp = await gapi(`/drive/v3/files?q=${q}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=1000`);
    if (!resp.ok) return 0;
    const json = await resp.json();
    return (json.files || []).length;
  }

  async function createFolder(parentId, name) {
    const resp = await gapi("/drive/v3/files?supportsAllDrives=true", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      }),
    });
    if (!resp.ok) throw new Error("Drive folder create failed: " + resp.status);
    return await resp.json();
  }

  // Multipart upload for small/medium files. Sufficient for typical photos.
  async function uploadPhoto(folderId, name, blob, onProgress) {
    const metadata = { name, parents: [folderId] };
    const boundary = "btc_boundary_" + Math.random().toString(36).slice(2);
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelim = `\r\n--${boundary}--`;
    const arrayBuf = await blob.arrayBuffer();
    const metaPart = `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}`;
    const filePartHeader = `Content-Type: ${blob.type || "application/octet-stream"}\r\nContent-Transfer-Encoding: binary\r\n\r\n`;

    const encoder = new TextEncoder();
    const head = encoder.encode(delimiter + metaPart + delimiter + filePartHeader);
    const tail = encoder.encode(closeDelim);
    const body = new Uint8Array(head.byteLength + arrayBuf.byteLength + tail.byteLength);
    body.set(head, 0);
    body.set(new Uint8Array(arrayBuf), head.byteLength);
    body.set(tail, head.byteLength + arrayBuf.byteLength);

    // XHR for upload progress.
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true");
      xhr.setRequestHeader("Authorization", `Bearer ${state.accessToken}`);
      xhr.setRequestHeader("Content-Type", `multipart/related; boundary=${boundary}`);
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      });
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch (e) { resolve({}); }
        } else {
          reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.send(body);
    });
  }

  // ---------- HEIC → JPG (lazy load heic2any) ----------
  let heicLoaderPromise = null;
  function loadHeic2Any() {
    if (heicLoaderPromise) return heicLoaderPromise;
    heicLoaderPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js";
      s.onload = () => resolve(window.heic2any);
      s.onerror = () => reject(new Error("Failed to load HEIC converter"));
      document.head.appendChild(s);
    });
    return heicLoaderPromise;
  }
  async function ensureJpegBlob(photo) {
    if (photo.jpegBlob) return photo.jpegBlob;
    const isHeic = /\.heic$/i.test(photo.file.name) || photo.file.type === "image/heic" || photo.file.type === "image/heif";
    if (!isHeic) {
      photo.jpegBlob = photo.file;
      return photo.jpegBlob;
    }
    const heic2any = await loadHeic2Any();
    const out = await heic2any({ blob: photo.file, toType: "image/jpeg", quality: 0.92 });
    photo.jpegBlob = Array.isArray(out) ? out[0] : out;
    return photo.jpegBlob;
  }

  // ---------- Master sheet (Citizen Science) ----------
  // Ensures the sheet's first row contains the expected headers (inserting a
  // row above existing data if needed), and applies bold + freeze formatting.
  // Self-healing: safe to call before every append.
  async function ensureMasterSheetHeaders(sheetId, headers) {
    const checkResp = await gapi(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1`);
    if (!checkResp.ok) {
      const errText = await checkResp.text().catch(() => "");
      throw new Error(`Header check failed (${checkResp.status}): ${errText.slice(0, 200)}`);
    }
    const data = await checkResp.json();
    const a1Value = (data.values && data.values[0] && data.values[0][0]) || null;
    if (a1Value === headers[0]) return; // already has headers

    // Need the sheet's grid sheetId for structural batchUpdate requests.
    const metaResp = await gapi(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets(properties(sheetId))`);
    if (!metaResp.ok) {
      const errText = await metaResp.text().catch(() => "");
      throw new Error(`Sheet metadata failed (${metaResp.status}): ${errText.slice(0, 200)}`);
    }
    const meta = await metaResp.json();
    const gridSheetId = meta.sheets[0].properties.sheetId;

    const requests = [];
    // If there's existing data in A1, push it down by inserting an empty row.
    if (a1Value !== null) {
      requests.push({
        insertDimension: {
          range: { sheetId: gridSheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
          inheritFromBefore: false,
        },
      });
    }
    // Bold + freeze the header row for usability.
    requests.push({
      updateSheetProperties: {
        properties: { sheetId: gridSheetId, gridProperties: { frozenRowCount: 1 } },
        fields: "gridProperties.frozenRowCount",
      },
    });
    requests.push({
      repeatCell: {
        range: { sheetId: gridSheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: "userEnteredFormat.textFormat.bold",
      },
    });
    const batchResp = await gapi(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    });
    if (!batchResp.ok) {
      const errText = await batchResp.text().catch(() => "");
      throw new Error(`Header insert failed (${batchResp.status}): ${errText.slice(0, 200)}`);
    }
    // Write the header values into the now-empty row 1.
    const writeResp = await gapi(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1?valueInputOption=RAW`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: [headers] }),
    });
    if (!writeResp.ok) {
      const errText = await writeResp.text().catch(() => "");
      throw new Error(`Header write failed (${writeResp.status}): ${errText.slice(0, 200)}`);
    }
  }

  async function findOrCreateMasterSheet(survey) {
    const ms = survey.masterSheet;
    let sheetId = null;
    const cachedId = localStorage.getItem(ms.storageKey);
    if (cachedId) {
      const check = await gapi(`/drive/v3/files/${cachedId}?fields=id&supportsAllDrives=true`);
      if (check.ok) sheetId = cachedId;
    }
    if (!sheetId) {
      // Look in the parent folder for a sheet with the configured title.
      const q = encodeURIComponent(`mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and name='${ms.title.replace(/'/g, "\\'")}' and '${ms.parentFolderId}' in parents`);
      const search = await gapi(`/drive/v3/files?q=${q}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`);
      if (search.ok) {
        const searchData = await search.json();
        if (searchData.files && searchData.files[0]) {
          sheetId = searchData.files[0].id;
          localStorage.setItem(ms.storageKey, sheetId);
        }
      }
    }
    if (!sheetId) {
      const createResp = await gapi("/drive/v3/files?supportsAllDrives=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: ms.title,
          mimeType: "application/vnd.google-apps.spreadsheet",
          parents: [ms.parentFolderId],
        }),
      });
      if (!createResp.ok) throw new Error("Failed to create master sheet: " + createResp.status);
      const file = await createResp.json();
      sheetId = file.id;
      localStorage.setItem(ms.storageKey, sheetId);
    }
    // Always make sure headers are in place — handles the case where the sheet
    // existed but headers were never successfully written (or were deleted).
    await ensureMasterSheetHeaders(sheetId, ms.headers);
    return sheetId;
  }

  async function appendMasterSheetRow(sheetId, row) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const resp = await gapi(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: [row] }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`Append failed (${resp.status}): ${errText.slice(0, 200)}`);
    }
  }

  // ---------- Upload flow ----------
  async function startUpload() {
    if (!canUpload() || state.uploading) return;
    state.uploading = true;
    updateUploadButton();
    const survey = state.currentSurvey;
    const resultEl = $("#upload-result");
    resultEl.className = "submit-result info";
    resultEl.textContent = "Preparing upload…";

    try {
      const folderName = getFolderName();
      // 1. Find or create the dated subfolder.
      let folder = await findFolderByName(survey.driveFolderId, folderName);
      let useExisting = false;
      let existingPhotoCount = 0;
      if (folder) {
        existingPhotoCount = await countPhotosInFolder(folder.id);
        const choice = await promptDupFolder(folderName, existingPhotoCount);
        if (choice === "cancel") {
          state.uploading = false;
          resultEl.className = "submit-result info";
          resultEl.textContent = "Upload cancelled.";
          updateUploadButton();
          return;
        }
        if (choice === "add") {
          useExisting = true;
        } else if (choice === "suffix") {
          // Find first free suffix.
          let suffix = 2;
          while (await findFolderByName(survey.driveFolderId, `${folderName}-${suffix}`)) suffix++;
          folder = await createFolder(survey.driveFolderId, `${folderName}-${suffix}`);
          existingPhotoCount = 0;
        }
      } else {
        folder = await createFolder(survey.driveFolderId, folderName);
      }

      // 2. If sequence continues from folder, offset session indices.
      //    Manually-overridden numbers are respected (user took explicit control).
      const seq = survey.photo.sequence;
      const seqOffset = (seq && seq.continueFromFolder && useExisting) ? existingPhotoCount : 0;
      if (seq) {
        state.photos.forEach((p, i) => {
          if (p._seqOverridden) return;
          p.values[seq.field] = String(i + 1 + seqOffset);
          if (p._seqInputEl) p._seqInputEl.value = p.values[seq.field];
          updatePhotoPreview(p);
        });
      }

      // 3. Upload each photo sequentially (keeps order + simpler retries).
      let successCount = 0;
      for (const photo of state.photos) {
        if (photo.status === "uploaded") { successCount++; continue; }
        photo.status = "uploading";
        photo.error = null;
        photo._rowEl.classList.remove("failed", "uploaded");
        photo._rowEl.classList.add("uploading");
        ensureProgressBar(photo);
        try {
          const blob = await ensureJpegBlob(photo);
          const name = getPhotoFilename(photo);
          const result = await uploadPhoto(folder.id, name, blob, (pct) => {
            if (photo._progressFill) photo._progressFill.style.width = `${Math.round(pct * 100)}%`;
          });
          photo.driveId = result.id;
          photo.status = "uploaded";
          photo._rowEl.classList.remove("uploading");
          photo._rowEl.classList.add("uploaded");
          if (photo._progressFill) photo._progressFill.style.width = "100%";
          successCount++;
        } catch (err) {
          photo.status = "failed";
          photo.error = err.message;
          photo._rowEl.classList.remove("uploading");
          photo._rowEl.classList.add("failed");
          photo._errorEl.textContent = err.message;
        }
      }

      // 4. Citizen Science master sheet append (only if all photos uploaded).
      if (survey.masterSheet && successCount > 0) {
        try {
          const sheetId = await findOrCreateMasterSheet(survey);
          const folderUrl = `https://drive.google.com/drive/folders/${folder.id}`;
          const fv = state.folderValues;
          const mv = state.masterSheetValues;
          const row = [
            fv.date || "",
            fv.site || "",
            fv.uploadMethod || "",
            // Submitted By: take from the first photo's submittedBy (per-photo field).
            (state.photos.find((p) => p.values.submittedBy) || { values: {} }).values.submittedBy || "",
            mv.depth || "",
            mv.time || "",
            mv.approximateSize || "",
            mv.sharksSeenTotal || "",
            successCount,
            mv.submissionNote || "",
            folderUrl,
            new Date().toISOString(),
          ];
          await appendMasterSheetRow(sheetId, row);
        } catch (err) {
          resultEl.className = "submit-result error";
          resultEl.textContent = `${successCount}/${state.photos.length} photos uploaded, but master sheet append failed: ${err.message}`;
          state.uploading = false;
          updateUploadButton();
          return;
        }
      }

      const failed = state.photos.length - successCount;
      if (failed === 0) {
        resultEl.className = "submit-result success";
        const sheetNote = survey.masterSheet ? " Master sheet row added." : "";
        resultEl.innerHTML = `✓ Uploaded ${successCount} photo${successCount === 1 ? "" : "s"} to <a href="https://drive.google.com/drive/folders/${folder.id}" target="_blank" rel="noopener">${folderName}</a>.${sheetNote}`;
      } else {
        resultEl.className = "submit-result error";
        resultEl.textContent = `${successCount} uploaded, ${failed} failed. Press Upload again to retry failed photos.`;
      }
    } catch (err) {
      resultEl.className = "submit-result error";
      resultEl.textContent = `Upload failed: ${err.message}`;
    }
    state.uploading = false;
    updateUploadButton();
  }

  function ensureProgressBar(photo) {
    if (photo._progressFill) return;
    const track = el("div", { class: "progress-track" });
    const fill = el("div", { class: "progress-fill" });
    track.appendChild(fill);
    photo._rowEl.appendChild(track);
    photo._progressFill = fill;
  }

  function promptDupFolder(name, count) {
    return new Promise((resolve) => {
      const tpl = $("#tpl-dup-folder").content.cloneNode(true);
      const backdrop = tpl.querySelector(".modal-backdrop");
      tpl.querySelector("#dup-folder-name").textContent = name;
      tpl.querySelector("#dup-folder-count").textContent = String(count);
      tpl.querySelectorAll("[data-action]").forEach((btn) => {
        btn.addEventListener("click", () => {
          document.body.removeChild(backdrop);
          resolve(btn.dataset.action);
        });
      });
      document.body.appendChild(tpl);
    });
  }

  // ---------- Init ----------
  function enterPreviewMode() {
    state.previewMode = true;
    $("#auth-prompt").classList.add("hidden");
    $("#uploader").classList.remove("hidden");
    $("#preview-banner").classList.remove("hidden");
    $("#auth-btn").textContent = "Sign in";
    if (!state.currentSurvey) selectSurvey(SURVEYS[0].key);
    updateUploadButton();
  }

  function exitPreviewMode() {
    state.previewMode = false;
    $("#preview-banner").classList.add("hidden");
    updateUploadButton();
  }

  function bindAuthButtons() {
    $("#auth-btn").addEventListener("click", requestSignIn);
    const large = $("#auth-btn-large");
    if (large) large.addEventListener("click", requestSignIn);
    const preview = $("#preview-btn");
    if (preview) preview.addEventListener("click", enterPreviewMode);
    const bannerSignin = $("#preview-banner-signin");
    if (bannerSignin) bannerSignin.addEventListener("click", requestSignIn);
  }

  function bindUploadButtons() {
    $("#upload-btn").addEventListener("click", startUpload);
    $("#clear-btn").addEventListener("click", () => {
      // Full reset of the current survey: photos, folder fields, master sheet fields.
      if (state.currentSurvey) selectSurvey(state.currentSurvey.key);
    });
  }

  function bindNetStatus() {
    const dot = $("#net-status");
    const update = () => dot.classList.toggle("offline", !navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();
  }

  function init() {
    renderSurveyToggle();
    bindDropArea();
    bindAuthButtons();
    bindUploadButtons();
    bindNetStatus();
    // Pre-tint with first survey palette so it doesn't flash teal-green default.
    if (SURVEYS.length) applyTheme(SURVEYS[0].theme);
    // Wait for GSI to be ready before initialising token client.
    const waitForGsi = setInterval(() => {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        clearInterval(waitForGsi);
        initAuth();
      }
    }, 200);
    // Service worker for PWA caching.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
