/* ================================================================
   MatAi 2027 — shared site script
   Injects header + footer, handles nav, reveal, tabs, accordion,
   countdown. Pure DOM (works via file:// or a server).
   ================================================================ */
(function () {
  "use strict";

  var SITE_SRC = (document.currentScript && document.currentScript.src) || "js/site.js";
  var countdownInterval = null;
  var revealObserver = null;

  var PAGE_SECTION_NAV = {
    "about.html": [
      { id: "about-overview", label: "About the Conference" },
      { id: "aims-objectives", label: "Aims & Objectives" },
      { id: "why-attend", label: "Why Attend" },
      { id: "target-audience", label: "Target Audience" },
      { id: "agenda", label: "Conference Agenda" },
      { id: "conference-highlights", label: "Conference Highlights" },
      { id: "at-a-glance", label: "At a Glance" },
      { id: "about-cta", label: "Be Part of MatAi 2027" }
    ],
    "committee.html": [
      { id: "committee-overview", label: "Committee Overview" },
      { id: "committee-responsibilities", label: "Committee Responsibilities" },
      { id: "scientific-committee", label: "Scientific Committee" },
      { id: "international-advisory", label: "International Advisory Committee" },
      { id: "committee-cta", label: "Join the Scientific Community" }
    ],
    "contact.html": [
      { id: "contact-overview", label: "Contact Overview" },
      { id: "contact-details", label: "MatAi 2027" },
      { id: "contact-help", label: "What We Can Help With" },
      { id: "contact-glance", label: "At a Glance" }
    ],
    "brochure.html": [
      { id: "brochure-glance", label: "MatAi 2027 at a Glance" },
      { id: "brochure-details", label: "Conference Brochure" }
    ],
    "sessions.html": [
      { id: "sessions-overview", label: "Scientific Sessions Overview" },
      { id: "sessions-pillars", label: "Four Major Scientific Pillars" },
      { id: "sessions-accommodation", label: "Session Formats" },
      { id: "sessions-present", label: "Present Your Research" }
    ],
    "registration.html": [
      { id: "registration-steps", label: "Registration Steps" },
      { id: "registration-details", label: "Registration" },
      { id: "registration-policies", label: "What's Included & Registration Policies" }
    ],
    "speakers.html": [
      { id: "speaker-overview", label: "Conference Speaker Overview" },
      { id: "keynote-speakers", label: "Keynote Speakers" },
      { id: "plenary-speakers", label: "Plenary Speakers" },
      { id: "featured-invited-speakers", label: "Featured / Invited Speakers" },
      { id: "oral-poster-presentations", label: "Oral & Poster Presentations" },
      { id: "speaker-program-coverage", label: "Speaker Program Coverage" },
      { id: "speaker-participation", label: "Speaker Participation" }
    ],
    "abstract-submission.html": [
      { id: "call-for-abstracts", label: "Call for Abstracts" },
      { id: "submission-areas", label: "Submission Areas" },
      { id: "presentation-categories", label: "Presentation Categories" },
      { id: "guidelines", label: "Abstract Preparation" },
      { id: "process", label: "Submission & Review Process" },
      { id: "dates", label: "Important Dates" },
      { id: "eligibility", label: "Eligibility" },
      { id: "checklist", label: "Final Checklist" },
      { id: "submit", label: "Abstract Submission Form" }
    ],
    "venue.html": [
      { id: "venue-overview", label: "Berlin, Germany" },
      { id: "venue-information", label: "Venue Information" },
      { id: "venue-facilities", label: "Venue Facilities" },
      { id: "poster-topics", label: "Poster Topics" },
      { id: "presentation-av-facilities", label: "Presentation & AV Facilities" },
      { id: "room-arrangement", label: "Conference Room Arrangement" },
      { id: "venue-location", label: "Location & Map" },
      { id: "nearby-accommodation", label: "Nearby Accommodation" },
      { id: "explore-berlin", label: "Explore Berlin" },
      { id: "recommended-arrival", label: "Recommended Arrival" },
      { id: "venue-highlights", label: "Venue Highlights" },
      { id: "venue-conduct-safety", label: "Code of Conduct & Safety" },
      { id: "speaker-exhibitor-info", label: "Speakers & Exhibitors" },
      { id: "venue-summary", label: "Venue Information Summary" },
      { id: "venue-cta", label: "Join Us in Berlin" }
    ],
    "information.html": [
      { id: "information-overview", label: "Conference Information" },
      { id: "abstract-guidelines", label: "Abstract Submission Guidelines" },
      { id: "speaker-guidelines", label: "Speaker Guidelines" },
      { id: "conference-guidelines", label: "Conference Guidelines" },
      { id: "participation", label: "Participation Guidelines" },
      { id: "presentation", label: "Oral Presentation Guidelines" },
      { id: "poster-guidelines", label: "Poster Presentation Guidelines" },
      { id: "guidelines", label: "Registration Guidelines" },
      { id: "publication", label: "Publication & Proceedings" },
      { id: "certificates", label: "Certificates" },
      { id: "awards", label: "Awards & Recognition" },
      { id: "conduct", label: "Code of Conduct" },
      { id: "terms", label: "Terms & Conditions" },
      { id: "refund", label: "Cancellation & Refund Policy" },
      { id: "privacy", label: "Privacy Policy" },
      { id: "faq", label: "Frequently Asked Questions" },
      { id: "information-cta", label: "Still Have Questions?" }
    ],
    "sponsors.html": [
      { id: "sponsor-overview", label: "Sponsor & Exhibition Overview" },
      { id: "why-partner", label: "Why Partner" },
      { id: "sponsorship-tiers", label: "Sponsorship Tiers" },
      { id: "sponsorship-comparison", label: "Sponsorship Comparison" },
      { id: "exhibition-booths", label: "Exhibition Booths" },
      { id: "exhibitor-benefits", label: "Exhibitor Benefits" },
      { id: "industry-presentation", label: "Industry Presentation" },
      { id: "targeted-opportunities", label: "Targeted Opportunities" },
      { id: "custom-sponsorship", label: "Custom Sponsorship" },
      { id: "organizations", label: "Organizations We Welcome" },
      { id: "sponsor-visibility", label: "Sponsor Visibility" },
      { id: "exhibition-guidelines", label: "Exhibition Guidelines" },
      { id: "sponsorship-terms", label: "Sponsorship Terms" },
      { id: "sponsor-cta", label: "Become a Sponsor or Exhibitor" }
    ]
  };

  function pageDrop(href) {
    return (PAGE_SECTION_NAV[href] || []).map(function (item) {
      return { href: href + "#" + item.id, label: item.label };
    });
  }

  var PAGES = [
    {
      href: "index.html",
      label: "Home"
    },
    {
      href: "about.html",
      label: "About",
      drop: [
        { href: "about.html", label: "About the Conference", drop: pageDrop("about.html") },
        { href: "committee.html", label: "Scientific Committee", drop: pageDrop("committee.html") }
      ]
    },
    {
      href: "sessions.html",
      label: "Program",
      drop: [
        { href: "sessions.html", label: "Scientific Sessions", drop: pageDrop("sessions.html") },
        { href: "speakers.html", label: "Speakers", drop: pageDrop("speakers.html") },
        { href: "abstract-submission.html", label: "Abstract Submission", drop: pageDrop("abstract-submission.html") }
      ]
    },
    { href: "venue.html", label: "Venue", drop: pageDrop("venue.html") },
    {
      href: "information.html",
      label: "Resources",
      drop: [
        { href: "information.html", label: "Conference Information", drop: pageDrop("information.html") },
        { href: "brochure.html", label: "Conference Brochure", drop: pageDrop("brochure.html") },
        { href: "sponsors.html", label: "Sponsors & Exhibition", drop: pageDrop("sponsors.html") }
      ]
    },
    { href: "registration.html", label: "Registration" },
    { href: "contact.html", label: "Contact", drop: pageDrop("contact.html") }
  ];

  var current = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  if (current === "") current = "index.html";

  /* ---------- Build header ---------- */
  function buildHeader() {
    function renderNavItem(item) {
      var hasDrop = item.drop && item.drop.length;
      var submenu = hasDrop
        ? '<ul class="dropdown">' + item.drop.map(renderNavItem).join("") + "</ul>"
        : "";
      return '<li' + (hasDrop ? ' class="has-drop"' : "") + '>' +
        '<a href="' + item.href + '"' + (hasDrop ? ' aria-haspopup="true" aria-expanded="false"' : "") + ">" +
        item.label + "</a>" + submenu + "</li>";
    }

    var links = PAGES.map(function (p) {
      var active = p.href.split("#")[0] === current || (p.drop || []).some(function (item) {
        return item.href.split("#")[0] === current;
      }) ? " active" : "";
      var hasDrop = p.drop && p.drop.length ? " has-drop" : "";
      var dd = p.drop && p.drop.length
        ? '<ul class="dropdown">' + p.drop.map(renderNavItem).join("") + "</ul>"
        : "";
      return '<li class="' + (active + hasDrop).trim() + '">' +
        '<a href="' + p.href + '"' + (p.drop ? ' aria-haspopup="true" aria-expanded="false"' : "") + ">" +
        p.label + "</a>" + dd + "</li>";
    }).join("");

    return '' +
      '<header class="site-header">' +
      '<div class="container nav">' +
        '<a class="brand" href="index.html">' +
          '<span class="logo">Ai</span>' +
          '<span class="brand-title"><span class="brand-mat">Mat</span><span class="brand-ai">Ai</span> <span class="brand-year">2027</span><small>Materials · Engineering · AI</small></span>' +
        '</a>' +
        '<nav aria-label="Primary"><ul class="nav-links" id="navLinks">' + links + '</ul></nav>' +
        '<div class="nav-cta">' +
          '<a class="btn btn-primary btn-sm" href="registration.html">Register Now</a>' +
          '<button class="nav-toggle" id="navToggle" type="button" aria-label="Open navigation menu" aria-controls="navLinks" aria-expanded="false"><span></span><span></span><span></span></button>' +
        '</div>' +
      '</div>' +
      '</header>';
  }

  /* ---------- Build footer ---------- */
  function buildFooter() {
    var y = new Date().getFullYear();
    return '' +
      '<footer class="site-footer">' +
      '<div class="container">' +
        '<div class="footer-grid">' +
          '<div class="footer-brand">' +
            '<div class="logo">Ai</div>' +
            '<strong class="footer-wordmark"><span class="brand-mat">Mat</span><span class="brand-ai">Ai</span> <span class="brand-year">2027</span></strong>' +
            '<p>International Conference on Materials Science, Engineering &amp; Artificial Intelligence.</p>' +
            '<p><strong style="color:#fff">October 13–14, 2027</strong><br>Berlin, Germany</p>' +
          '</div>' +
          '<div>' +
            '<h5>Explore</h5>' +
            '<ul>' +
              '<li><a href="about.html">About</a></li>' +
              '<li><a href="committee.html">Committee</a></li>' +
              '<li><a href="speakers.html">Speakers</a></li>' +
              '<li><a href="sessions.html">Sessions</a></li>' +
              '<li><a href="venue.html">Venue</a></li>' +
            '</ul>' +
          '</div>' +
          '<div>' +
            '<h5>Participate</h5>' +
            '<ul>' +
              '<li><a href="abstract-submission.html">Submit Abstract</a></li>' +
              '<li><a href="registration.html">Registration</a></li>' +
              '<li><a href="brochure.html">Download Brochure</a></li>' +
              '<li><a href="sponsors.html">Sponsor / Exhibit</a></li>' +
              '<li><a href="information.html">Information</a></li>' +
              '<li><a href="contact.html">Contact</a></li>' +
            '</ul>' +
          '</div>' +
          '<div>' +
            '<h5>Contact</h5>' +
            '<ul>' +
              '<li>Email: <a href="mailto:info@matai2027.org">info@matai2027.org</a></li>' +
              '<li>Abstracts: <a href="mailto:abstracts@matai2027.org">abstracts@matai2027.org</a></li>' +
              '<li>Sponsors: <a href="mailto:sponsors@matai2027.org">sponsors@matai2027.org</a></li>' +
              '<li>Berlin, Germany</li>' +
            '</ul>' +
          '</div>' +
        '</div>' +
        '<div class="footer-bottom">' +
          '<span>© ' + y + ' MatAi 2027 — International Conference on Materials Science, Engineering &amp; Artificial Intelligence.</span>' +
          '<span>Advancing Materials Innovation through Science, Engineering &amp; Artificial Intelligence. · <a href="admin.html">Admin</a></span>' +
        '</div>' +
      '</div>' +
      '</footer>';
  }

  /* ---------- Interactions ---------- */
  function initNav() {
    var toggle = document.getElementById("navToggle");
    var links = document.getElementById("navLinks");
    if (toggle && links) {
      function setMenuOpen(open) {
        links.classList.toggle("open", open);
        toggle.setAttribute("aria-expanded", String(open));
        toggle.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
        if (!open) {
          links.querySelectorAll(".has-drop.drop-open").forEach(function (li) {
            li.classList.remove("drop-open");
            var trigger = li.querySelector(":scope > a");
            if (trigger) trigger.setAttribute("aria-expanded", "false");
          });
        }
      }

      toggle.addEventListener("click", function () {
        setMenuOpen(!links.classList.contains("open"));
      });
      links.addEventListener("click", function (e) {
        if (e.target.tagName !== "A") return;
        var item = e.target.parentNode;
        if (item.classList.contains("has-drop")) {
          e.preventDefault();
          Array.prototype.forEach.call(item.parentNode.children, function (sibling) {
            if (sibling !== item && sibling.classList.contains("has-drop") && sibling.classList.contains("drop-open")) {
              var otherTrigger = sibling.querySelector(":scope > a");
              sibling.classList.remove("drop-open");
              if (otherTrigger) otherTrigger.setAttribute("aria-expanded", "false");
            }
          });
          var isOpen = item.classList.toggle("drop-open");
          e.target.setAttribute("aria-expanded", String(isOpen));
          return;
        }
        if (!item.classList.contains("has-drop")) {
          setMenuOpen(false);
          links.querySelectorAll(".has-drop.drop-open").forEach(function (li) { li.classList.remove("drop-open"); });
        }
      });
      document.addEventListener("click", function (e) {
        if (!links.contains(e.target) && !toggle.contains(e.target)) setMenuOpen(false);
        if (!links.contains(e.target)) {
          links.querySelectorAll(".has-drop.drop-open").forEach(function (li) { li.classList.remove("drop-open"); });
        }
      });
      document.addEventListener("keydown", function (e) {
        if (e.key !== "Escape" || !links.classList.contains("open")) return;
        setMenuOpen(false);
        toggle.focus();
      });
      window.addEventListener("resize", function () {
        if (window.matchMedia("(min-width: 1001px)").matches) setMenuOpen(false);
      });
    }
  }

  function initPagePanels() {
    var items = PAGE_SECTION_NAV[current];
    if (!items || !items.length) return;

    var sections = Array.prototype.slice.call(document.querySelectorAll("body > section.section")).filter(function (section) {
      return !section.classList.contains("page-section-picker") && !section.classList.contains("abstract-section-picker");
    });
    if (!sections.length) return;

    var picker = document.getElementById("page-section-picker") || document.getElementById("abstract-section-picker");
    if (!picker) {
      picker = document.createElement("section");
      picker.className = "section page-section-picker";
      picker.id = "page-section-picker";
      var hero = document.querySelector(".page-hero");
      if (hero && hero.parentNode) hero.parentNode.insertBefore(picker, hero.nextSibling);
    }

    picker.innerHTML =
      '<div class="container">' +
        '<div class="center reveal"><span class="eyebrow">' + pageTitle() + '</span><h2>Select a Section</h2></div>' +
        '<div class="grid cols-3 mt-2">' + items.map(function (item) {
          return '<a class="session-card reveal" href="#' + item.id + '"><h4>' + item.label + '</h4></a>';
        }).join("") + '</div>' +
      '</div>';

    items.forEach(function (item, index) {
      if (!sections[index]) return;
      sections[index].id = item.id;
      sections[index].setAttribute("data-page-panel", "1");
    });
    var panels = sections.slice(0, items.length);

    function pageTitle() {
      var title = document.querySelector(".page-hero h1");
      return title ? title.textContent : "Page Sections";
    }

    function selectedPanel() {
      var id = decodeURIComponent((location.hash || "").replace(/^#/, ""));
      return panels.find(function (panel) { return panel.id === id; });
    }

    function applySelection() {
      var active = selectedPanel();
      picker.hidden = !!active;
      panels.forEach(function (panel) { panel.hidden = !active || panel !== active; });
      (active || picker).querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in"); });
      if (active) window.scrollTo({ top: 0, behavior: "smooth" });
    }

    window.addEventListener("hashchange", applySelection);
    applySelection();
  }

  function initReveal() {
    var els = document.querySelectorAll(".reveal:not(.in)");
    if (!("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("in"); });
      return;
    }
    if (!revealObserver) {
      revealObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.classList.add("in");
            revealObserver.unobserve(en.target);
          }
        });
      }, { threshold: 0.12 });
    }
    els.forEach(function (el) { revealObserver.observe(el); });
  }

  function revealContentSections() {
    initCountdown();
    initReveal();
    document.querySelectorAll("body > section .reveal:not(.in)").forEach(function (el) {
      el.classList.add("in");
    });
  }

  function initAccordion() {
    document.querySelectorAll(".acc-q").forEach(function (q) {
      q.addEventListener("click", function () {
        var item = q.closest(".acc-item");
        var a = item.querySelector(".acc-a");
        var open = item.classList.toggle("open");
        a.style.maxHeight = open ? a.scrollHeight + "px" : null;
      });
    });
  }

  function initTabs() {
    document.querySelectorAll("[data-tabs]").forEach(function (group) {
      var btns = group.querySelectorAll(".tab-btn");
      btns.forEach(function (btn) {
        btn.addEventListener("click", function () {
          var target = btn.getAttribute("data-tab");
          btns.forEach(function (b) { b.classList.remove("active"); });
          btn.classList.add("active");
          group.querySelectorAll(".tab-panel").forEach(function (p) {
            p.classList.toggle("active", p.getAttribute("data-panel") === target);
          });
        });
      });
    });
  }

  function initCountdown() {
    if (countdownInterval !== null) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    var box = document.getElementById("countdown");
    if (!box) return;
    var target = new Date("2027-10-13T09:00:00").getTime();
    function tick() {
      var diff = target - Date.now();
      if (diff < 0) diff = 0;
      var d = Math.floor(diff / 86400000);
      var h = Math.floor((diff % 86400000) / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      var s = Math.floor((diff % 60000) / 1000);
      box.innerHTML =
        cd(d, "Days") + cd(h, "Hours") + cd(m, "Minutes") + cd(s, "Seconds");
    }
    function cd(v, l) { return '<div class="cd"><b>' + v + "</b><small>" + l + "</small></div>"; }
    tick();
    countdownInterval = setInterval(tick, 1000);
  }

  /* ---------- Clickable speaker/member profiles ---------- */
  function initProfiles() {
    // Build the modal shell once (needed even if cards arrive later via CMS).
    var modal = document.createElement("div");
    modal.className = "profile-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML =
      '<div class="profile-dialog" role="document">' +
        '<button class="profile-close" type="button" aria-label="Close">&times;</button>' +
        '<div class="pm-top">' +
          '<div class="pm-photo" id="pm-photo"></div>' +
          '<div class="pm-name" id="pm-name"></div>' +
          '<div class="pm-role" id="pm-role"></div>' +
          '<div class="pm-org" id="pm-org"></div>' +
        '</div>' +
        '<div class="pm-body">' +
          '<div id="pm-topic-wrap" style="display:none"><h5>Presentation / Focus</h5><p class="pm-topic" id="pm-topic"></p></div>' +
          '<div id="pm-bio-wrap" style="display:none"><h5>Profile</h5><p class="pm-bio" id="pm-bio"></p></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    var lastFocus = null;
    var closeBtn = modal.querySelector(".profile-close");

    function fill(card) {
      var name = card.getAttribute("data-name") || (card.querySelector("h4") ? card.querySelector("h4").textContent : "");
      var role = card.getAttribute("data-role") || (card.querySelector(".role") ? card.querySelector(".role").textContent : "");
      var org = card.getAttribute("data-org") || (card.querySelector(".org") ? card.querySelector(".org").textContent : "");
      var photo = card.getAttribute("data-photo");
      var fallback = card.querySelector(".avatar") ? card.querySelector(".avatar").textContent.trim() : "👤";
      var topic = card.getAttribute("data-topic");
      var bio = card.getAttribute("data-bio");

      modal.querySelector("#pm-name").textContent = name;
      modal.querySelector("#pm-role").textContent = role;
      modal.querySelector("#pm-org").textContent = org;
      modal.querySelector("#pm-photo").innerHTML = photo
        ? '<img src="' + photo + '" alt="' + name + '">'
        : fallback;

      var topicWrap = modal.querySelector("#pm-topic-wrap");
      if (topic) { modal.querySelector("#pm-topic").textContent = topic; topicWrap.style.display = "block"; }
      else { topicWrap.style.display = "none"; }

      var bioWrap = modal.querySelector("#pm-bio-wrap");
      if (bio) { modal.querySelector("#pm-bio").textContent = bio; bioWrap.style.display = "block"; }
      else { bioWrap.style.display = "none"; }
    }

    function open(card) {
      lastFocus = document.activeElement;
      fill(card);
      modal.classList.add("open");
      modal.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      closeBtn.focus();
    }
    function close() {
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    // Add the "View Profile →" hint / a11y attrs to any static cards that
    // don't already carry them (CMS-rendered cards include their own).
    function enhance(root) {
      (root || document).querySelectorAll(".person[data-profile]").forEach(function (card) {
        card.setAttribute("tabindex", "0");
        card.setAttribute("role", "button");
        if (!card.querySelector(".view-profile")) {
          var hint = document.createElement("span");
          hint.className = "view-profile";
          hint.textContent = "View Profile →";
          card.appendChild(hint);
        }
      });
    }
    enhance(document);

    // Event delegation so cards injected later (committee CMS) still work.
    document.addEventListener("click", function (e) {
      var card = e.target.closest ? e.target.closest(".person[data-profile]") : null;
      if (card) open(card);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var card = e.target.closest ? e.target.closest(".person[data-profile]") : null;
      if (card) { e.preventDefault(); open(card); }
    });

    closeBtn.addEventListener("click", close);
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("open")) close();
    });

    // Re-enhance when CMS content re-renders committee cards.
    document.addEventListener("matai:content", function () { enhance(document); });
  }

  /* ---------- Load public content loader once ---------- */
  function ensureContentScript() {
    if (window.MATAI_CONTENT || document.querySelector('script[data-matai-content]')) return;
    var src = SITE_SRC.replace(/site\.js.*$/, "content.js?v=20261010-live-sync2");
    var s = document.createElement("script");
    s.async = false;
    s.src = src; s.setAttribute("data-matai-content", "1");
    document.body.appendChild(s);
  }

  /* ---------- Boot ---------- */
  function boot() {
    var h = document.getElementById("site-header");
    var f = document.getElementById("site-footer");
    if (h) h.outerHTML = buildHeader();
    if (f) f.outerHTML = buildFooter();
    initNav();
    initPagePanels();
    initReveal();
    initAccordion();
    initTabs();
    initCountdown();
    document.addEventListener("matai:content", revealContentSections);
    initProfiles();
    ensureContentScript();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }
})();
