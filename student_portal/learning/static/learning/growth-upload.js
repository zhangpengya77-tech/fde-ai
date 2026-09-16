let stagedFiles = [];
let stagedPhotos = [];
let nextPhotoId = 0;
let stagedDocuments = [];
let nextDocumentId = 0;

document.querySelectorAll("[data-growth-form]").forEach((form) => {
  const fileInput = form.querySelector("[data-growth-images]");
  const photoPicker = form.querySelector("[data-growth-photo-picker]");
  const videoInput = form.querySelector("[data-growth-video]");
  const videoPicker = form.querySelector("[data-growth-video-picker]");
  const videoPreview = form.querySelector("[data-growth-video-preview]");
  const videoStatus = form.querySelector("[data-growth-video-status]");
  const documentInput = form.querySelector("[data-growth-documents]");
  const documentList = form.querySelector("[data-growth-document-list]");
  const documentStatus = form.querySelector("[data-growth-document-status]");
  const photoList = form.querySelector("[data-growth-photo-list]");
  const photoCount = form.querySelector("[data-growth-photo-count]");
  const progress = form.querySelector("[data-upload-progress]");
  const status = form.querySelector("[data-upload-status]");
  const buttons = Array.from(form.querySelectorAll("button[type=submit]"));
  const savedCount = Math.max(0, Number(form.dataset.existingImageCount || 0));
  const photoLimit = 5;
  const previewUrls = new Map();
  let lastSubmitAction = "save_draft";
  let stagedVideo = null;
  let stagedVideoPreviewUrl = null;

  function updatePhotoCount() {
    const total = savedCount + stagedFiles.length;
    if (photoCount) {
      photoCount.textContent = `共 ${total} / ${photoLimit} 張（已保存 ${savedCount}，待保存 ${stagedFiles.length}）`;
    }
    if (photoList) photoList.dataset.stagedCount = String(stagedFiles.length);
    form.dataset.stagedPhotoCount = String(stagedFiles.length);
  }

  function renderStagedPhotos() {
    if (!photoList) return;
    photoList.querySelectorAll("[data-pending-photo]").forEach((item) => item.remove());

    stagedPhotos.forEach((entry, index) => {
      const article = document.createElement("article");
      article.className = "growth-photo growth-photo-pending";
      article.dataset.pendingPhoto = "";

      const image = document.createElement("img");
      image.src = entry.previewUrl;
      image.alt = `待提交照片 ${index + 1}`;

      const caption = document.createElement("small");
      caption.textContent = `照片 ${savedCount + index + 1} · 待保存`;

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "small-button growth-photo-remove";
      removeButton.textContent = "×";
      removeButton.setAttribute("aria-label", `刪除待提交照片 ${index + 1}`);
      removeButton.addEventListener("click", () => {
        const indexToRemove = stagedPhotos.findIndex((photo) => photo.id === entry.id);
        if (indexToRemove < 0) return;
        stagedFiles.splice(indexToRemove, 1);
        const [removed] = stagedPhotos.splice(indexToRemove, 1);
        URL.revokeObjectURL(removed.previewUrl);
        previewUrls.delete(removed.id);
        renderStagedPhotos();
        if (status) status.textContent = "照片已從待提交清單移除。";
      });

      article.append(image, caption, removeButton);
      photoList.append(article);
    });
    updatePhotoCount();
  }

  function addSelectedFiles(fileList) {
    const newFiles = Array.from(fileList || []);
    const available = Math.max(0, photoLimit - savedCount - stagedFiles.length);
    const acceptedFiles = newFiles.slice(0, available);
    const entries = acceptedFiles.map((file) => {
      const id = `growth-photo-${++nextPhotoId}`;
      const previewUrl = URL.createObjectURL(file);
      previewUrls.set(id, previewUrl);
      return { id, file, previewUrl };
    });

    stagedFiles.push(...acceptedFiles);
    stagedPhotos.push(...entries);
    if (fileInput) fileInput.value = "";
    renderStagedPhotos();

    const rejectedCount = newFiles.length - acceptedFiles.length;
    if (rejectedCount && status) {
      status.textContent = "每項學習成長記錄最多上傳5張照片，請先刪除現有照片再添加。";
    } else if (acceptedFiles.length && status) {
      status.textContent = "照片已加入待提交清單。";
    }
  }

  if (fileInput && photoList && photoCount && window.FormData && window.XMLHttpRequest) {
    fileInput.addEventListener("change", () => addSelectedFiles(fileInput.files));
    photoPicker?.addEventListener("click", (event) => {
      if (savedCount + stagedFiles.length >= photoLimit) {
        event.preventDefault();
        if (status) status.textContent = "每項學習成長記錄最多上傳5張照片，請先刪除現有照片再添加。";
      }
    });
    photoPicker?.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && savedCount + stagedFiles.length < photoLimit) {
        event.preventDefault();
        fileInput.click();
      }
    });
    updatePhotoCount();
  }

  function renderStagedDocuments() {
    if (!documentList) return;
    documentList.replaceChildren();
    stagedDocuments.forEach((entry, index) => {
      const item = document.createElement("article");
      item.className = "growth-document growth-document-pending";

      const details = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = entry.file.name;
      const state = document.createElement("small");
      state.textContent = `待提交檔案 ${index + 1}`;
      details.append(name, state);

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "small-button growth-photo-remove";
      removeButton.textContent = "×";
      removeButton.setAttribute("aria-label", `刪除待提交成果檔案 ${index + 1}`);
      removeButton.addEventListener("click", () => {
        stagedDocuments = stagedDocuments.filter((item) => item.id !== entry.id);
        renderStagedDocuments();
        if (documentStatus) documentStatus.textContent = "成果檔案已從待提交清單移除。";
      });

      item.append(details, removeButton);
      documentList.append(item);
    });
    if (documentStatus && stagedDocuments.length) {
      documentStatus.textContent = `已選擇 ${stagedDocuments.length} 個成果檔案，保存草稿或提交複核時會上傳。`;
    }
  }

  if (documentInput && documentList) {
    documentInput.addEventListener("change", () => {
      const newFiles = Array.from(documentInput.files || []);
      newFiles.forEach((file) => {
        stagedDocuments.push({ id: `growth-document-${++nextDocumentId}`, file });
      });
      documentInput.value = "";
      renderStagedDocuments();
    });
  }

  function renderVideoPreview() {
    if (!videoPreview) return;
    videoPreview.replaceChildren();
    if (!stagedVideo || !stagedVideoPreviewUrl) {
      videoPreview.hidden = true;
      return;
    }
    const player = document.createElement("video");
    player.controls = true;
    player.preload = "metadata";
    player.playsInline = true;
    player.src = stagedVideoPreviewUrl;
    player.setAttribute("aria-label", `待提交影片 ${stagedVideo.name}`);
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "small-button";
    removeButton.textContent = "刪除待提交影片";
    removeButton.setAttribute("aria-label", "刪除待提交影片");
    removeButton.addEventListener("click", () => {
      stagedVideo = null;
      if (stagedVideoPreviewUrl) URL.revokeObjectURL(stagedVideoPreviewUrl);
      stagedVideoPreviewUrl = null;
      videoInput.value = "";
      renderVideoPreview();
      if (videoStatus) videoStatus.textContent = "待提交影片已移除。";
    });
    videoPreview.append(player, removeButton);
    videoPreview.hidden = false;
  }

  if (videoInput) {
    videoInput.addEventListener("change", () => {
      const selected = Array.from(videoInput.files || [])[0];
      if (!selected) return;
      if (stagedVideoPreviewUrl) URL.revokeObjectURL(stagedVideoPreviewUrl);
      stagedVideo = selected;
      stagedVideoPreviewUrl = URL.createObjectURL(selected);
      videoInput.value = "";
      renderVideoPreview();
      if (videoStatus) videoStatus.textContent = "影片已加入，保存草稿或提交複核時會上傳並處理。";
    });
    videoPicker?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        videoInput.click();
      }
    });
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      lastSubmitAction = button.value || "save_draft";
    });
  });

  form.addEventListener("submit", (event) => {
    const submitter = event.submitter;
    const action = submitter?.value || lastSubmitAction;
    if (action === "submit_review" && !window.confirm("確定提交給教師複核嗎？提交後將暫時無法修改照片，除非教師要求補充。")) {
      event.preventDefault();
      return;
    }

    if (!(window.FormData && window.XMLHttpRequest)) return;
    event.preventDefault();

    const formData = new FormData(form);
    formData.set("action", action);
    stagedFiles.forEach((file) => formData.append("images", file, file.name));
    if (stagedVideo) formData.append("video", stagedVideo, stagedVideo.name);
    stagedDocuments.forEach(({ file }) => formData.append("documents", file, file.name));
    buttons.forEach((button) => { button.disabled = true; });
    if (progress) {
      progress.value = 0;
      progress.hidden = false;
    }
    if (status) status.textContent = stagedVideo ? "影片上傳中…" : (stagedDocuments.length ? "成果檔案上傳中…" : "正在上傳並處理照片…");
    if (videoStatus && stagedVideo) videoStatus.textContent = "影片上傳中…";

    const request = new XMLHttpRequest();
    request.open("POST", form.getAttribute("action") || window.location.href);
    request.setRequestHeader("X-Requested-With", "XMLHttpRequest");
    request.upload.addEventListener("progress", (uploadEvent) => {
      if (!uploadEvent.lengthComputable || !progress) return;
      progress.value = Math.round((uploadEvent.loaded / uploadEvent.total) * 100);
       if (uploadEvent.loaded === uploadEvent.total) {
         if (stagedVideo && videoStatus) videoStatus.textContent = "影片已上傳，正在處理…";
         if (documentStatus && stagedDocuments.length) documentStatus.textContent = "成果檔案已上傳，正在保存…";
         if (status) status.textContent = stagedVideo ? "影片已上傳，正在處理…" : (stagedDocuments.length ? "成果檔案已上傳，正在保存…" : "照片已上傳，正在保存…");
       }
    });
    request.addEventListener("load", () => {
      const contentType = request.getResponseHeader("Content-Type") || "";
      if (request.status >= 200 && request.status < 300 && contentType.includes("application/json")) {
        let result = null;
        try {
          result = JSON.parse(request.responseText);
        } catch (_error) {
          result = null;
        }
        if (result?.ok) {
          stagedFiles.length = 0;
          stagedPhotos.length = 0;
          stagedVideo = null;
          stagedDocuments = [];
          if (stagedVideoPreviewUrl) URL.revokeObjectURL(stagedVideoPreviewUrl);
          stagedVideoPreviewUrl = null;
          previewUrls.forEach((url) => URL.revokeObjectURL(url));
          previewUrls.clear();
          renderStagedDocuments();
          window.location.reload();
          return;
        }
      }

      const responseDocument = new DOMParser().parseFromString(request.responseText, "text/html");
      const errors = Array.from(responseDocument.querySelectorAll(".error"))
        .map((item) => item.textContent.trim())
        .filter(Boolean);
      buttons.forEach((button) => { button.disabled = false; });
      if (progress) {
        progress.hidden = true;
        progress.value = 0;
      }
      if (status) status.textContent = errors[0] || "保存失敗，照片仍保留在待提交清單，請稍後重試。";
      if (videoStatus && stagedVideo && !errors.length) videoStatus.textContent = status.textContent;
    });
    request.addEventListener("error", () => {
      buttons.forEach((button) => { button.disabled = false; });
      if (progress) {
        progress.hidden = true;
        progress.value = 0;
      }
      if (status) status.textContent = "網路連線中斷，照片仍保留在待提交清單，請確認連線後重試。";
      if (videoStatus && stagedVideo) videoStatus.textContent = "網路連線中斷，影片仍保留在待提交狀態，請確認連線後重試。";
    });
    request.send(formData);
  });
});
