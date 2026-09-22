(function () {
  "use strict";

  const form = document.querySelector("[data-survey-form]");
  if (!form) return;

  const contactSection = form.querySelector("[data-contact-email-section]");
  const contactEmail = form.querySelector("#id_contact_email");
  const contactChoices = form.querySelectorAll("input[name='contact_opt_in']");
  const futureChoices = form.querySelectorAll("input[name='future_interests']");

  function syncContactEmail() {
    const selected = form.querySelector("input[name='contact_opt_in']:checked");
    const visible = selected && selected.value === "true";
    if (contactSection) contactSection.hidden = !visible;
    if (contactEmail) contactEmail.setAttribute("aria-hidden", String(!visible));
  }

  contactChoices.forEach((choice) => choice.addEventListener("change", syncContactEmail));
  syncContactEmail();

  futureChoices.forEach((choice) => {
    choice.addEventListener("change", () => {
      const selected = form.querySelectorAll("input[name='future_interests']:checked");
      if (selected.length >= 3) {
        futureChoices.forEach((item) => {
          if (!item.checked) item.disabled = true;
        });
      } else {
        futureChoices.forEach((item) => { item.disabled = false; });
      }
    });
  });
})();
