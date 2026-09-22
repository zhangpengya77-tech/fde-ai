(function () {
  "use strict";

  const form = document.querySelector("[data-survey-form]");
  if (!form) return;

  const contactSection = form.querySelector("[data-contact-email-section]") || form.querySelector("[data-advanced-section]");
  const contactEmail = form.querySelector("#id_contact_email");
  const contactChoices = form.querySelectorAll("input[name='contact_opt_in']");
  const futureChoices = form.querySelectorAll("input[name='future_interests']");
  const intentChoices = form.querySelectorAll("input[name='q8_intent']");
  const advancedSection = form.querySelector("[data-advanced-section]");

  function enforceLimit(name, limit, exclusiveValue) {
    const choices = form.querySelectorAll(`input[name='${name}']`);
    if (!choices.length) return;
    const sync = () => {
      const selected = [...choices].filter((item) => item.checked);
      if (exclusiveValue && selected.some((item) => item.value === exclusiveValue)) {
        choices.forEach((item) => { item.checked = item.value === exclusiveValue; });
        return;
      }
      choices.forEach((item) => {
        item.disabled = !item.checked && selected.length >= limit;
      });
    };
    choices.forEach((choice) => choice.addEventListener("change", sync));
    sync();
  }

  function syncOtherField(name) {
    const wrapper = form.querySelector(`[data-other-field='${name}']`);
    if (!wrapper) return;
    const visible = [...form.querySelectorAll(`input[name='${name}']:checked`)].some((item) => item.value === "other");
    wrapper.hidden = !visible;
  }

  function syncContactEmail() {
    const selected = form.querySelector("input[name='contact_opt_in']:checked");
    const visible = selected && selected.value === "true";
    if (contactSection) contactSection.hidden = !visible;
    if (contactEmail) contactEmail.setAttribute("aria-hidden", String(!visible));
  }

  contactChoices.forEach((choice) => choice.addEventListener("change", syncContactEmail));
  syncContactEmail();

  function syncAdvancedSection() {
    const selected = form.querySelector("input[name='q8_intent']:checked");
    const visible = selected && ["deep_learning", "learn_more"].includes(selected.value);
    if (advancedSection) advancedSection.hidden = !visible;
    if (advancedSection) advancedSection.setAttribute("aria-hidden", String(!visible));
  }

  intentChoices.forEach((choice) => choice.addEventListener("change", syncAdvancedSection));
  syncAdvancedSection();

  enforceLimit("q3_topics", 3);
  enforceLimit("q6_interests", 3);
  enforceLimit("q7_paths", 2, "undecided");
  enforceLimit("q9_courses", 2);
  ["q3_topics", "q4_improvements"].forEach((name) => {
    form.querySelectorAll(`input[name='${name}']`).forEach((choice) => choice.addEventListener("change", () => syncOtherField(name)));
    syncOtherField(name);
  });

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
