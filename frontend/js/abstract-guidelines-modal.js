/* Reuses the authoritative guidelines section already rendered on abstracts.html. */
(function () {
  "use strict";

  var source = document.querySelector("#abstract-guidelines .container");
  var opener = document.getElementById("abstract-guidelines-open");
  if (!source || !opener) return;

  var modal = document.createElement("div");
  modal.className = "tc-modal abstract-guidelines-modal";
  modal.id = "abstract-guidelines-modal";
  modal.setAttribute("aria-hidden", "true");
  modal.innerHTML =
    '<div class="tc-dialog" role="dialog" aria-modal="true" aria-labelledby="abstract-guidelines-modal-title">' +
      '<div class="tc-head"><h3 id="abstract-guidelines-modal-title">Abstract Guidelines</h3>' +
      '<button type="button" class="tc-x" aria-label="Close Abstract Guidelines">×</button></div>' +
      '<div class="tc-body abstract-guidelines-modal-body"></div>' +
      '<div class="tc-foot"><button type="button" class="btn btn-primary">Close</button></div>' +
    '</div>';
  document.body.appendChild(modal);

  // This copies the existing complete source section at open time; no second
  // guideline document is maintained for the form.
  var body = modal.querySelector(".abstract-guidelines-modal-body");
  body.innerHTML = source.innerHTML;
  body.querySelectorAll(".btn-row").forEach(function (row) { row.remove(); });

  var closeButtons = modal.querySelectorAll("button");
  var lastFocus = null;
  function open() {
    lastFocus = document.activeElement;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    body.scrollTop = 0;
    modal.querySelector(".tc-x").focus();
  }
  function close() {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  opener.addEventListener("click", function (event) { event.preventDefault(); open(); });
  closeButtons.forEach(function (button) { button.addEventListener("click", close); });
  modal.addEventListener("click", function (event) { if (event.target === modal) close(); });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && modal.classList.contains("open")) close();
  });
})();
