/* ================================================================
   MatAi 2027 — public content loader
   Fetches editable content from the backend (/api/content) and
   applies it to the page: announcement banner, [data-content] text,
   and dynamic lists. Falls back to built-in defaults on file://.
   Exposes window.MATAI_CONTENT and fires a "matai:content" event.
   ================================================================ */
(function () {
  "use strict";

  var DEFAULTS = {
    banner: { enabled: true, text: "Abstract submissions for MatAi 2027 are now open. Register early to secure Early-Bird rates." },
    site: { theme: "Advancing Materials Innovation through Science, Engineering & Artificial Intelligence", dateText: "October 13–14, 2027", city: "Berlin, Germany" },
    dates: [
      { label: "Abstract Submission Deadline", value: "To Be Announced" },
      { label: "Early-Bird Registration Deadline", value: "To Be Announced" },
      { label: "Conference Dates", value: "October 13–14, 2027" }
    ],
    fees: {
      "Early Bird": { Speaker: 649, Delegate: 749, Poster: 549, Student: 399, Virtual: 299 },
      "Mid-Term":   { Speaker: 749, Delegate: 849, Poster: 649, Student: 499, Virtual: 399 },
      "On-Spot":    { Speaker: 849, Delegate: 949, Poster: 749, Student: 599, Virtual: 499 }
    },
    registrationPeriods: {
      active: "Early Bird",
      "Early Bird": { label: "Early Bird Registration", deadline: "To Be Announced" },
      "Mid-Term": { label: "Mid Term Registration", deadline: "To Be Announced" },
      "On-Spot": { label: "Late Registration", deadline: "To Be Announced" }
    },
    pages: {},
    committee: [],
    speakers: []
  };

  function get(obj, path) {
    return path.split(".").reduce(function (o, k) { return (o && o[k] != null) ? o[k] : undefined; }, obj);
  }

  function formatDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return value || "To Be Announced";
    var parts = value.split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
      .toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }

  function apply(content) {
    window.MATAI_CONTENT = content;

    // Announcement banner
    var banner = content.banner || {};
    var announcement = document.getElementById("announce-bar");
    if (banner.enabled && banner.text) {
      if (!announcement) {
        announcement = document.createElement("div");
        announcement.id = "announce-bar";
        announcement.className = "announce-bar";
        document.body.insertBefore(announcement, document.body.firstChild);
      }
      announcement.innerHTML = '<div class="container"><span>' + escapeHtml(banner.text) + "</span></div>";
    } else if (announcement) {
      announcement.remove();
    }

    // [data-content="site.theme"] style bindings
    document.querySelectorAll("[data-content]").forEach(function (el) {
      var v = get(content, el.getAttribute("data-content"));
      if (v != null) el.textContent = v;
    });

    // Dynamic lists, e.g. [data-content-list="dates"]
    document.querySelectorAll('[data-content-list="dates"]').forEach(function (box) {
      var dates = content.dates || [];
      box.innerHTML = dates.map(function (d) {
        return '<div class="date-row"><span class="dl">' + escapeHtml(d.label) +
          '</span><span class="dv">' + escapeHtml(formatDate(d.value)) + "</span></div>";
      }).join("");
    });

    renderRegistrationPlans(content);

    // Fee cells: <td data-fee="Period|Category">
    var fees = content.fees || {};
    document.querySelectorAll("[data-fee]").forEach(function (cell) {
      var p = cell.getAttribute("data-fee").split("|");
      var v = fees[p[0]] && fees[p[0]][p[1]];
      if (v != null) cell.textContent = "€" + v;
    });

    // Page section overrides saved from the admin panel.
    var current = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    var pageOverrides = content.pages && content.pages[current];
    document.querySelectorAll("body > section.page-added-section").forEach(function (section) {
      section.remove();
    });
    if (pageOverrides) {
      var sections = Array.prototype.slice.call(document.querySelectorAll("body > section")).filter(function (section) {
        return !section.classList.contains("page-section-picker") &&
          !section.classList.contains("abstract-section-picker") &&
          !section.classList.contains("page-added-section");
      });
      sections.forEach(function (section, i) {
        if (!section.hasAttribute("data-page-section-index")) section.setAttribute("data-page-section-index", String(i));
      });
      if (!document.body.hasAttribute("data-page-original-section-count")) {
        document.body.setAttribute("data-page-original-section-count", String(sections.length));
      }
      var originalSectionCount = Number(document.body.getAttribute("data-page-original-section-count")) || sections.length;
      sections.slice().forEach(function (section) {
        var saved = pageOverrides["sec-" + section.getAttribute("data-page-section-index")];
        if (saved && saved.deleted) section.remove();
        else if (saved && saved.html != null) section.innerHTML = saved.html;
      });
      Object.keys(pageOverrides).filter(function (key) {
        return /^sec-\d+$/.test(key) && Number(key.slice(4)) >= originalSectionCount;
      }).sort(function (a, b) {
        return Number(a.slice(4)) - Number(b.slice(4));
      }).forEach(function (key) {
        var saved = pageOverrides[key];
        if (!saved || !saved.html) return;
        var section = document.createElement("section");
        section.className = "section page-added-section";
        section.innerHTML = saved.html;
        var footer = document.querySelector("body > footer");
        document.body.insertBefore(section, footer || null);
      });
    }

    // Committee members: [data-committee-group="<key>"] containers.
    // Speakers: [data-speaker-group="<key>"] containers.
    // Members/speakers entered in the admin panel render here as clickable
    // profile cards; empty groups fall back to a "will be added" message.
    renderPeople("[data-committee-group]", "data-committee-group",
      Array.isArray(content.committee) ? content.committee : [],
      "Committee members will be added later.", "👤");
    renderPeople("[data-speaker-group]", "data-speaker-group",
      Array.isArray(content.speakers) ? content.speakers : [],
      "Speaker names and profiles will be published in the final scientific program.", "🎤");

    try { document.dispatchEvent(new CustomEvent("matai:content", { detail: content })); } catch (_) {}
  }

  // Render a set of profile cards into every container matching `selector`,
  // filtered by the group value read from `attr`. Shows a placeholder note
  // when a group has no people. Cards reuse .person[data-profile] so the
  // shared profile modal (site.js) opens on click.
  function renderPeople(selector, attr, people, defaultEmpty, defaultAvatar) {
    document.querySelectorAll(selector).forEach(function (box) {
      var key = box.getAttribute(attr);
      var avatarEmoji = box.getAttribute("data-avatar") || defaultAvatar || "👤";
      var mine = people.filter(function (m) { return m && m.group === key; });
      var fallback = box.getAttribute("data-empty") || defaultEmpty;
      if (!mine.length) {
        box.innerHTML = '<p class="placeholder-note center mt-2">' +
          escapeHtml(fallback) + "</p>";
        return;
      }
      box.innerHTML = mine.map(function (m) {
        var name = escapeHtml(m.name || "");
        var role = escapeHtml(m.role || "");
        var org = escapeHtml(m.org || "");
        var photo = m.photo ? escapeHtml(m.photo) : "";
        var bio = m.bio ? escapeHtml(m.bio) : "";
        var topic = m.topic ? escapeHtml(m.topic) : "";
        var avatar = photo
          ? '<div class="avatar"><img src="' + photo + '" alt="' + name + '"></div>'
          : '<div class="avatar">' + avatarEmoji + "</div>";
        return '<div class="person reveal in" data-profile data-name="' + name +
          '" data-role="' + role + '" data-org="' + org + '"' +
          (photo ? ' data-photo="' + photo + '"' : "") +
          (topic ? ' data-topic="' + topic + '"' : "") +
          (bio ? ' data-bio="' + bio + '"' : "") +
          ' tabindex="0" role="button">' + avatar +
          "<h4>" + name + '</h4><div class="role">' + role +
          '</div><div class="org">' + org +
          '</div><span class="view-profile">View Profile →</span></div>';
      }).join("");
    });
  }

  function renderRegistrationPlans(content) {
    var containers = document.querySelectorAll("[data-registration-plans]");
    if (!containers.length) return;

    var periods = content.registrationPeriods || {};
    var order = ["Early Bird", "Mid-Term", "On-Spot"];
    var index = order.indexOf(periods.active);
    if (index < 0) index = 0;
    var today = new Date().toISOString().slice(0, 10);
    while (index < order.length - 1) {
      var current = periods[order[index]] || {};
      if (!/^\d{4}-\d{2}-\d{2}$/.test(current.deadline || "") || current.deadline >= today) break;
      index += 1;
    }

    var period = order[index];
    var label = periods[period] && periods[period].label || period + " Registration";
    var fees = content.fees && content.fees[period] || {};
    var categories = ["Speaker", "Delegate", "Poster", "Student", "Virtual"];
    var plans = categories.filter(function (category) {
      return fees[category] != null && isFinite(Number(fees[category])) && Number(fees[category]) >= 0;
    });

    containers.forEach(function (container) {
      if (!plans.length) {
        container.innerHTML = '<p class="placeholder-note center">Registration prices are temporarily unavailable. Please contact the organizers.</p>';
        return;
      }
      container.innerHTML = plans.map(function (category) {
        return '<article class="card registration-plan">' +
          '<span class="eyebrow">' + escapeHtml(label) + '</span>' +
          '<h3>' + escapeHtml(category) + '</h3>' +
          '<p class="registration-plan-price">€' + Number(fees[category]).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
          '<small> / participant</small></p>' +
          '<p>Plus 5% tax. Optional items are priced separately.</p>' +
          '<a class="btn btn-outline mt-2" href="registration.html">Registration Details</a>' +
          '</article>';
      }).join("");
    });
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function boot() {
    if (location.protocol === "file:") { apply(DEFAULTS); return; }
    function refresh() {
      return fetch("/api/content", { cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error("Could not load website content (" + r.status + ").");
          return r.json();
        })
        .then(function (j) {
          if (!j || !j.content) throw new Error("The website content response was invalid.");
          apply(j.content);
        });
    }
    refresh().catch(function (err) {
      console.error("Could not load website content:", err);
      apply(DEFAULTS);
    });

    if ("BroadcastChannel" in window) {
      var channel = new BroadcastChannel("matai-site-content");
      channel.addEventListener("message", function (event) {
        if (event.data && event.data.type === "content-updated") {
          refresh().catch(function (err) { console.error("Could not refresh website content:", err); });
        }
      });
    } else {
      window.addEventListener("storage", function (event) {
        if (event.key === "matai-content-updated" && event.newValue) {
          refresh().catch(function (err) { console.error("Could not refresh website content:", err); });
        }
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
