document.querySelectorAll("[data-growth-form]").forEach((form) => {
  form.addEventListener("submit", (event) => {
    const submitter = event.submitter;
    if (submitter?.value === "submit_review" && !window.confirm("確認提交後，這筆記錄將送交教師複核？")) {
      event.preventDefault();
      return;
    }

    if (!(window.FormData && window.XMLHttpRequest)) return;
    event.preventDefault();

    const progress = form.querySelector("[data-upload-progress]");
    const status = form.querySelector("[data-upload-status]");
    const buttons = Array.from(form.querySelectorAll("button[type=submit]"));
    const formData = new FormData(form);
    if (submitter?.name) formData.append(submitter.name, submitter.value);
    buttons.forEach((button) => { button.disabled = true; });
    if (progress) progress.hidden = false;
    if (status) status.textContent = "正在上傳並處理照片…";

    const request = new XMLHttpRequest();
    request.open("POST", form.getAttribute("action") || window.location.href);
    request.upload.addEventListener("progress", (uploadEvent) => {
      if (!uploadEvent.lengthComputable || !progress) return;
      progress.value = Math.round((uploadEvent.loaded / uploadEvent.total) * 100);
      if (uploadEvent.loaded === uploadEvent.total && status) status.textContent = "照片已上傳，正在保存…";
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 500) {
        document.open();
        document.write(request.responseText);
        document.close();
        return;
      }
      buttons.forEach((button) => { button.disabled = false; });
      if (status) status.textContent = "保存失敗，請稍後重試。";
    });
    request.addEventListener("error", () => {
      buttons.forEach((button) => { button.disabled = false; });
      if (status) status.textContent = "網路連線中斷，請確認連線後重試。";
    });
    request.send(formData);
  });
});
