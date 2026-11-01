/* Reuses the authoritative guidelines section already rendered on abstracts.html. */
(function () {
  "use strict";

  var modal = document.createElement("div");
  modal.className = "tc-modal abstract-guidelines-modal";
  modal.id = "abstract-guidelines-modal";
  modal.setAttribute("aria-hidden", "true");
  modal.hidden = true;
  modal.innerHTML =
    '<div class="tc-dialog" role="dialog" aria-modal="true" aria-labelledby="abstract-guidelines-modal-title">' +
      '<div class="tc-head"><h3 id="abstract-guidelines-modal-title">Abstract Guidelines</h3>' +
      '<button type="button" class="tc-x" aria-label="Close Abstract Guidelines">×</button></div>' +
      '<div class="tc-body abstract-guidelines-modal-body"></div>' +
      '<div class="tc-foot"><button type="button" class="btn btn-primary">Close</button></div>' +
    '</div>';
  document.body.appendChild(modal);

  var body = modal.querySelector(".abstract-guidelines-modal-body");

  var closeButtons = modal.querySelectorAll("button");
  var lastFocus = null;
  function open() {
    var source = document.querySelector("[data-abstract-guidelines-source] .container, #abstract-guidelines .container");
    if (!source) return;
    body.innerHTML = source.innerHTML;
    body.querySelectorAll(".btn-row").forEach(function (row) { row.remove(); });
    lastFocus = document.activeElement;
    modal.hidden = false;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    body.scrollTop = 0;
    modal.querySelector(".tc-x").focus();
  }
  function close() {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    modal.hidden = true;
    document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  document.addEventListener("click", function (event) {
    var opener = event.target.closest && event.target.closest("#abstract-guidelines-open");
    if (!opener) return;
    event.preventDefault();
    event.stopPropagation();
    open();
  });
  closeButtons.forEach(function (button) { button.addEventListener("click", close); });
  modal.addEventListener("click", function (event) { if (event.target === modal) close(); });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && modal.classList.contains("open")) close();
  });
})();
