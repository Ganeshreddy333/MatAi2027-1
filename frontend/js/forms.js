/* ================================================================
   MatAi 2027 — form handling & validation
   Submits to the backend API when available; otherwise stores
   the submission locally so the form still works when opened
   directly from disk (file://).
   ================================================================ */
(function () {
  "use strict";

  function showStatus(form, type, msg) {
    var box = form.querySelector(".form-status");
    if (!box) return;
    box.className = "form-status " + type;
    box.innerHTML = msg;
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function validate(form) {
    var ok = true;
    form.querySelectorAll("[required]").forEach(function (el) {
      var field = el.closest(".field");
      var val = (el.value || "").trim();
      var bad = !val;
      if (el.type === "email" && val) {
        bad = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
      }
      if (el.type === "checkbox") bad = !el.checked;
      if (el.type === "file" && el.files.length) {
        var file = el.files[0];
        bad = file.size > 5 * 1024 * 1024 || !/\.(pdf|doc|docx)$/i.test(file.name);
      }
      if (field) field.classList.toggle("invalid", bad);
      if (bad) ok = false;
    });
    form.querySelectorAll('input[type="file"]:not([required])').forEach(function (el) {
      var field = el.closest(".field");
      var file = el.files[0];
      var bad = !!file && (file.size > 5 * 1024 * 1024 || !/\.(pdf|doc|docx)$/i.test(file.name));
      if (field) field.classList.toggle("invalid", bad);
      if (bad) ok = false;
    });
    return ok;
  }

  function collect(form) {
    var data = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.type === "file") return;
      if (el.type === "checkbox") data[el.name] = el.checked;
      else if (el.type === "radio") { if (el.checked) data[el.name] = el.value; }
      else data[el.name] = el.value;
    });
    data._submittedAt = new Date().toISOString();
    return data;
  }

  function saveLocal(kind, data) {
    try {
      var key = "matai_" + kind;
      var arr = JSON.parse(localStorage.getItem(key) || "[]");
      arr.push(data);
      localStorage.setItem(key, JSON.stringify(arr));
      return true;
    } catch (e) { return false; }
  }

  function csrfToken() {
    return fetch("/api/csrf").then(function (response) {
      return response.json().then(function (result) {
        if (!response.ok || !result.token) throw new Error("Could not initialize request security.");
        return result.token;
      });
    });
  }

  function handle(form) {
    var kind = form.getAttribute("data-form");
    var endpoint = form.getAttribute("data-endpoint") || ("/api/" + kind);
    var btn = form.querySelector('[type="submit"]');

    // Live-clear invalid state
    form.addEventListener("input", function (e) {
      var field = e.target.closest(".field");
      if (field) field.classList.remove("invalid");
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!validate(form)) {
        showStatus(form, "err", "⚠ Please complete all required fields correctly.");
        return;
      }
      var hasFile = Array.prototype.some.call(form.querySelectorAll('input[type="file"]'), function (input) {
        return input.files && input.files.length > 0;
      });
      var data = hasFile ? new FormData(form) : collect(form);
      var origText = btn ? btn.textContent : "";
      if (btn) { btn.disabled = true; btn.textContent = "Submitting…"; }

      var done = function (via, resp) {
        form.reset();
        var ref = (resp && resp.reference) || ("MATAI-" + Date.now().toString(36).toUpperCase());
        var extra = "";
        if (resp && resp.download) {
          extra = '<br><a class="btn btn-primary btn-sm mt-1" href="' + resp.download + '" target="_blank" rel="noopener">Download the Brochure ↓</a>';
          try { window.open(resp.download, "_blank"); } catch (e) {}
        }
        showStatus(form, "ok",
          "✓ Thank you! Your " + kind + " submission has been received." +
          '<br><span style="font-weight:400;font-size:.88rem">Reference: <strong>' + ref + "</strong>" +
          (via === "local" ? " — saved locally on this device (start the server to store centrally)." : ".") +
          " Keep this reference for your records.</span>" + extra);
        if (btn) { btn.disabled = false; btn.textContent = origText; }
      };

      // Local storage cannot retain uploaded file data.
      if (location.protocol === "file:") {
        if (hasFile) {
          showStatus(form, "err", "⚠ File uploads aren't available in the offline preview. Start the local server to submit this form with its attachment.");
          if (btn) { btn.disabled = false; btn.textContent = origText; }
          return;
        }
        if (saveLocal(kind, data)) done("local");
        else {
          showStatus(form, "err", "⚠ This submission could not be saved in this browser. Please try again.");
          if (btn) { btn.disabled = false; btn.textContent = origText; }
        }
        return;
      }
      var request = { method: "POST", body: hasFile ? data : JSON.stringify(data) };
      request.headers = hasFile ? {} : { "Content-Type": "application/json" };
      csrfToken().then(function (token) {
        request.headers["X-CSRF-Token"] = token;
        return fetch(endpoint, request);
      }).then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error(j.error || "Submission failed.");
          return j;
        });
      }).then(function (j) { done("server", j); })
        .catch(function () {
          showStatus(form, "err", "⚠ We could not submit your form. Check your connection and try again.");
          if (btn) { btn.disabled = false; btn.textContent = origText; }
        });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("form[data-form]").forEach(handle);

    // Pre-select registration category from ?cat= or ?pkg=
    var params = new URLSearchParams(location.search);
    var cat = params.get("cat") || params.get("pkg");
    if (cat) {
      var sel = document.querySelector('select[name="category"]');
      if (sel) {
        Array.prototype.forEach.call(sel.options, function (o) {
          if (o.value.toLowerCase().indexOf(cat.toLowerCase()) !== -1) sel.value = o.value;
        });
      }
    }
  });
})();