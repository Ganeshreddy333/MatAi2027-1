/* ================================================================
   MatAi 2027 — Admin console logic
   ================================================================ */
(function () {
  "use strict";

  var STATUS = ["New", "Reviewed", "Approved", "Rejected", "Completed"];
  var BANK_PAYMENT_STATUSES = ["Pending", "Paid", "Cancelled"];
  var KIND_LABEL = { all: "All Submissions", register: "Registrations", abstract: "Abstracts", contact: "Contacts", brochure: "Brochure Requests" };
  var current = "dashboard";
  var csrfToken = "";
  var cache = {};      // kind -> items
  var contentData = null;
  var currentEditPage = "index.html";
  var PAGE_FILES = [
    { href: "index.html", label: "Home Page" },
    { href: "about.html", label: "About the Conference" },
    { href: "meet-our-experts.html", label: "Meet Our Experts" },
    { href: "abstracts.html", label: "Abstracts" },
    { href: "speakers.html", label: "Speakers" },
    { href: "venue.html", label: "Venue" },
    { href: "general-information.html", label: "General Information" },
    { href: "sponsors-exhibition.html", label: "Sponsors & Exhibition" },
    { href: "brochure.html", label: "Conference Brochure Request" },
    { href: "sponsors-brochure.html", label: "Sponsorship & Exhibition Brochure" },
    { href: "registration.html", label: "Registration" },
    { href: "contact-us.html", label: "Contact Us" },
  ];
  var FIXED_PRICE_ITEMS = [
    ["exhibition_standard", "Standard Exhibition Booth — 3 × 2 m"],
    ["exhibition_premium", "Premium Exhibition Booth — 3 × 3 m"],
    ["exhibition_startup", "Start-Up Pavilion"],
    ["sponsor_diamond", "Diamond Sponsor"],
    ["sponsor_platinum", "Platinum Sponsor"],
    ["sponsor_gold", "Gold Sponsor"],
    ["sponsor_silver", "Silver Sponsor"],
    ["sponsor_bronze", "Bronze / Supporting Sponsor"],
    ["sponsor_keynote", "Keynote Session Sponsor"],
    ["sponsor_plenary", "Plenary Session Sponsor"],
    ["sponsor_advertising", "Advertising Sponsor"],
    ["sponsor_coffee", "Coffee Break Sponsor"],
    ["sponsor_lunch", "Lunch Sponsor (per day)"],
    ["sponsor_reception", "Conference Reception Sponsor"],
    ["sponsor_kit", "Conference Kit Sponsor"],
    ["sponsor_lanyard", "Lanyard & Badge Sponsor"],
    ["sponsor_awards", "Awards & Young Researcher Sponsor"],
    ["sponsor_insert", "Delegate Kit Insert"],
    ["sponsor_industry", "Industry Presentation"],
    ["addon_social", "Social & Networking Event (per ticket)"],
    ["addon_accompanying", "Accompanying Person"],
    ["addon_accommodation_single", "Accommodation — Single Occupancy (per night)"],
    ["addon_accommodation_double", "Accommodation — Double Occupancy (per night)"]
  ];
  // This inventory is the single source of truth for public-page image overrides.
  // `defaultPath` remains in use whenever an administrator removes an override.
  var MEDIA_ITEMS = [
    { key: "homeHero", page: "Homepage", section: "Hero background", name: "MatAi hero image", defaultPath: "images/matai-hero-reference.png" },
    { key: "venueWelcome", page: "Venue", section: "Welcome to MatAi 2027", name: "Berlin skyline", defaultPath: "images/venue/image3.jpeg" },
    { key: "venueAuditorium", page: "Venue", section: "Conference Venue Facilities", name: "Main auditorium", defaultPath: "images/venue/image2.jpeg" },
    { key: "venueTechnical", page: "Venue", section: "Conference Venue Facilities", name: "Technical presentation room", defaultPath: "images/venue/technical-presentation-room.png" },
    { key: "venueAirportDay", page: "Venue", section: "Location and Transportation", name: "Airport terminal", defaultPath: "images/venue/image9.jpeg" },
    { key: "venueAirportNight", page: "Venue", section: "Location and Transportation", name: "Airport at night", defaultPath: "images/venue/image10.jpeg" },
    { key: "venueTrainInterior", page: "Venue", section: "Location and Transportation", name: "Berlin Hauptbahnhof interior", defaultPath: "images/venue/image8.jpeg" },
    { key: "venueTrainExterior", page: "Venue", section: "Location and Transportation", name: "Berlin Hauptbahnhof exterior", defaultPath: "images/venue/image11.jpeg" },
    { key: "venueHotel", page: "Venue", section: "Nearby Accommodation", name: "Hotel accommodation", defaultPath: "images/venue/image13.jpeg" },
    { key: "venueHotelExterior", page: "Venue", section: "Nearby Accommodation", name: "Hotel exterior", defaultPath: "images/venue/image14.jpeg" },
    { key: "venueLandmark1", page: "Venue", section: "Explore Berlin", name: "Brandenburg Gate", defaultPath: "images/venue/image4.jpeg" },
    { key: "venueLandmark2", page: "Venue", section: "Explore Berlin", name: "Reichstag building", defaultPath: "images/venue/image5.jpeg" },
    { key: "venueLandmark3", page: "Venue", section: "Explore Berlin", name: "Museum Island", defaultPath: "images/venue/image6.jpeg" },
    { key: "venueLandmark4", page: "Venue", section: "Explore Berlin", name: "Berlin landmarks", defaultPath: "images/venue/image17.jpeg" },
    { key: "venueLandmark5", page: "Venue", section: "Explore Berlin", name: "Historic attraction", defaultPath: "images/venue/image18.jpeg" },
    { key: "venueLandmark6", page: "Venue", section: "Explore Berlin", name: "Berlin travel image", defaultPath: "images/venue/image19.jpeg" }
  ];

  function $(s, r) { return (r || document).querySelector(s); }
  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function d(r, k) { return (r.data && r.data[k] != null) ? r.data[k] : ""; }
  function fmt(iso) { if (!iso) return ""; var dt = new Date(iso); return isNaN(dt) ? "" : dt.toLocaleString(); }
  function money(amount, currency) {
    currency = /^[A-Z]{3}$/.test(currency || "") ? currency : "EUR";
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency", currency: currency,
        minimumFractionDigits: 2, maximumFractionDigits: 2
      }).format(Number(amount) || 0) + " " + currency;
    } catch (_) {
      return currency + " " + (Number(amount) || 0).toFixed(2);
    }
  }

  function api(url, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    if (opts.method && opts.method.toUpperCase() !== "GET" && csrfToken) {
      opts.headers["X-CSRF-Token"] = csrfToken;
    }
    return fetch(url, opts).then(function (r) {
      if (r.status === 401) { showLogin(); throw new Error("unauth"); }
      var ct = r.headers.get("content-type") || "";
      return (ct.indexOf("json") > -1 ? r.json() : r.text()).then(function (body) {
        if (!r.ok) throw new Error(body && body.error ? body.error : "Request failed (" + r.status + ")");
        return body;
      });
    });
  }
  function toast(msg, err) {
    var t = el("toast"); t.textContent = msg; t.className = "toast show" + (err ? " err" : "");
    setTimeout(function () { t.className = "toast"; }, 2600);
  }
  function notifySiteContentChanged() {
    if ("BroadcastChannel" in window) {
      var channel = new BroadcastChannel("matai-site-content");
      channel.postMessage({ type: "content-updated" });
      channel.close();
      return;
    }
    try {
      localStorage.setItem("matai-content-updated", String(Date.now()));
    } catch (err) {
      console.error("Could not notify open website tabs about saved content:", err);
    }
  }

  /* ---------- Load dashboard ---------- */
  function loadAll() {
    if (current === "dashboard") {
      el("dashboard-state").hidden = false;
      el("dashboard-state").textContent = "Loading dashboard data...";
    }
    api("/admin/api/stats").then(function (j) {
      if (j && j.ok) {
        renderStats(j.stats);
        el("dashboard-state").hidden = true;
      }
    }).catch(function (err) {
      if (err.message !== "unauth") {
        el("dashboard-state").hidden = false;
        el("dashboard-state").textContent = "Dashboard data could not be loaded. Refresh to try again.";
        toast("Could not load dashboard statistics", true);
      }
    });
    if (current === "dashboard") return;
    if (["content", "information", "pages", "speakers", "media", "committee", "settings", "coupons"].indexOf(current) > -1) loadContent();
    else loadKind(current);
  }

  function renderStats(s) {
    var c = s.counts || {};
    var revenues = s.revenueByCurrency || {};
    var revenueText = Object.keys(revenues).sort().map(function (currency) {
      return money(revenues[currency], currency);
    }).join(" · ") || money(0, s.revenueCurrency || "EUR");
    var cards = [
      { b: c.register || 0, l: "Total registrations" },
      { b: s.paid || 0, l: "Confirmed registrations" },
      { b: s.pending || 0, l: "Pending payments" },
      { b: revenueText, l: "Total revenue · paid", wide: true },
      { b: c.abstract || 0, l: "Abstract submissions" },
      { b: s.pendingEnquiries || 0, l: "Pending enquiries" }
    ];
    var markup = cards.map(function (x) {
      return '<div class="a-stat' + (x.wide ? " a-stat-wide" : "") + '"><b>' + esc(x.b) + "</b><span>" + esc(x.l) + "</span></div>";
    }).join("");
    el("stats").innerHTML = markup;
    el("dashboard-stats").innerHTML = markup;
    var registrations = s.recentRegistrations || [];
    var payments = s.recentPayments || [];
    el("recent-registrations").innerHTML = registrations.map(function (r) {
      return "<tr><td class='a-ref'>" + esc(r.reference) + "</td><td>" + esc(r.fullName || "—") + "</td><td>" +
        esc(fmt(r.receivedAt)) + "</td><td>" + esc(r.paymentStatus || "Pending") + "</td></tr>";
    }).join("");
    el("recent-payments").innerHTML = payments.map(function (r) {
      return "<tr><td class='a-ref'>" + esc(r.reference) + "</td><td>" + esc(r.fullName || "—") + "</td><td>" +
        esc(money(r.amount, r.currency || "EUR")) + "</td><td>" + esc(r.paymentStatus || "Pending") + "</td></tr>";
    }).join("");
    el("recent-registrations-empty").hidden = registrations.length > 0;
    el("recent-payments-empty").hidden = payments.length > 0;
  }

  var VIEW_META = {
    dashboard: ["Dashboard", "Overview", "A live view of registrations, payments, abstracts, and enquiries."],
    content: ["Homepage & Conference", "Website Management", "Manage the conference announcement and homepage content."],
    information: ["Important Dates & Venue", "Website Management", "Manage the conference venue, map, and important dates."],
    media: ["Media Library", "Image & Media", "Manage public-site images and image replacements."],
    speakers: ["Speakers", "People Management", "Manage speaker profiles shown on the public conference pages."],
    committee: ["Organizing Committee", "People Management", "Manage organizing and scientific committee profiles."],
    registrations: ["Registrations", "Conference Operations", "Search, review, and manage submitted registrations."],
    abstracts: ["Abstracts", "Conference Operations", "Search and review submitted abstracts and uploaded documents."],
    payments: ["Payments", "Conference Operations", "Review registration payment status and verified amounts."],
    accommodation: ["Accommodation", "Conference Operations", "Review accommodation add-ons submitted with registrations."],
    enquiries: ["Enquiries & Requests", "Conference Operations", "Review contact enquiries and brochure requests."],
    settings: ["Registration Pricing", "Financial Configuration", "Manage registration periods, fees, and add-on prices."],
    coupons: ["Coupons", "Financial Configuration", "Manage registration discount codes."],
    pages: ["Pages", "Existing Module", "Manage public website pages using the existing page editor."]
  };
  var SUBMISSION_VIEWS = ["registrations", "abstracts", "payments", "accommodation", "enquiries"];

  function activateView(view) {
    if (!VIEW_META[view]) return;
    current = view;
    document.querySelectorAll(".admin-view").forEach(function (panel) {
      panel.style.display = panel.id === view + "-view" || (view === "registrations" && panel.id === "sub-view") ||
        (view === "abstracts" && panel.id === "sub-view") || (view === "payments" && panel.id === "sub-view") ||
        (view === "accommodation" && panel.id === "sub-view") || (view === "enquiries" && panel.id === "sub-view") ? "block" : "none";
    });
    document.querySelectorAll("#admin-navigation .a-tab").forEach(function (button) {
      button.classList.toggle("active", button.getAttribute("data-view") === view);
    });
    var meta = VIEW_META[view];
    el("main-title").textContent = meta[0];
    el("breadcrumb").textContent = meta[1] + " / " + meta[0];
    el("page-description").textContent = meta[2];
    var canSave = ["content", "information", "speakers", "committee", "settings", "coupons"].indexOf(view) > -1;
    el("save-content").style.display = canSave ? "inline-flex" : "none";
    if (view === "pages") {
      el("pages-index").style.display = "block";
      el("page-editor-view").style.display = "none";
      renderPageList();
    }
    if (SUBMISSION_VIEWS.indexOf(view) > -1) {
      el("submission-search").value = "";
      el("submission-status").value = "";
      loadKind(view);
    } else {
      loadAll();
    }
    if (window.matchMedia("(max-width: 900px)").matches) {
      $(".a-sidebar").classList.add("is-collapsed");
      $(".a-nav-toggle").setAttribute("aria-expanded", "false");
    }
  }

  /* ---------- Navigation ---------- */
  document.querySelector(".a-nav-tabs").addEventListener("click", function (e) {
    var target = e.target.closest("[data-view]");
    if (target) activateView(target.getAttribute("data-view"));
  });
  el("dashboard-view").addEventListener("click", function (e) {
    var target = e.target.closest("[data-view]");
    if (target) activateView(target.getAttribute("data-view"));
  });
  $(".a-nav-toggle").addEventListener("click", function () {
    var sidebar = $(".a-sidebar"), collapsed = sidebar.classList.toggle("is-collapsed");
    this.setAttribute("aria-expanded", String(!collapsed));
  });

  el("export-btn").addEventListener("click", function () {
    var kind = current === "abstracts" ? "abstract" :
      (current === "enquiries" || current === "accommodation" ? current : "register");
    window.open("/admin/api/export/" + encodeURIComponent(kind), "_blank");
  });
  el("submission-search").addEventListener("input", renderCurrentTable);
  el("submission-status").addEventListener("change", renderCurrentTable);
  el("submission-sort").addEventListener("change", renderCurrentTable);

  /* ---------- Submissions table ---------- */
  var COLS = {
    register: [
      { h: "Ref", f: function (r) { return '<span class="a-ref">' + esc(r.reference) + "</span>"; } },
      { h: "Name", f: function (r) { return esc(d(r, "fullName")); } },
      { h: "Email", f: function (r) { return esc(d(r, "email")); } },
      { h: "Category", f: function (r) { return esc(d(r, "category")) + '<div class="a-sub">' + esc(d(r, "period")) + "</div>"; } },
      { h: "Amount", f: function (r) { return money(r.amount, r.amountCurrency || r.transactionCurrency || "EUR"); } },
      { h: "Payment", f: function (r) { return paySelect(r); } },
      { h: "Received", f: function (r) { return '<span class="a-sub">' + fmt(r.receivedAt) + "</span>"; } }
    ],
    abstract: [
      { h: "Ref", f: function (r) { return '<span class="a-ref">' + esc(r.reference) + "</span>"; } },
      { h: "Title", f: function (r) { return esc(d(r, "title")); } },
      { h: "Author", f: function (r) { return esc(d(r, "authorName")); } },
      { h: "Email", f: function (r) { return esc(d(r, "email")); } },
      { h: "Status", f: function (r) { return statusPill(r); } },
      { h: "Received", f: function (r) { return '<span class="a-sub">' + fmt(r.receivedAt) + "</span>"; } }
    ],
    contact: [
      { h: "Ref", f: function (r) { return '<span class="a-ref">' + esc(r.reference) + "</span>"; } },
      { h: "Name", f: function (r) { return esc(d(r, "fullName")); } },
      { h: "Email", f: function (r) { return esc(d(r, "email")); } },
      { h: "Subject", f: function (r) { return esc(d(r, "subject")); } },
      { h: "Received", f: function (r) { return '<span class="a-sub">' + fmt(r.receivedAt) + "</span>"; } }
    ],
    brochure: [
      { h: "Ref", f: function (r) { return '<span class="a-ref">' + esc(r.reference) + "</span>"; } },
      { h: "Name", f: function (r) { return esc(d(r, "fullName")); } },
      { h: "Email", f: function (r) { return esc(d(r, "email")); } },
      { h: "Organization", f: function (r) { return esc(d(r, "organization")); } },
      { h: "Received", f: function (r) { return '<span class="a-sub">' + fmt(r.receivedAt) + "</span>"; } }
    ]
  };

  function paySelect(r) {
    return '<span class="a-readonly">' + esc(r.paymentStatus || "Pending") + "</span>";
  }
  function statusPill(r) {
    var v = r.status || "New";
    return '<span class="pill-status st-' + esc(v) + '">' + esc(v) + "</span>";
  }

  var currentTableItems = [];

  function loadKind(view) {
    var labels = {
      registrations: "Registrations", abstracts: "Abstracts", payments: "Payments",
      accommodation: "Accommodation", enquiries: "Enquiries & Requests"
    };
    var descriptions = {
      registrations: "Submitted registration records and payment status.",
      abstracts: "Abstract submissions and uploaded documents.",
      payments: "Payment status is sourced from stored registration records.",
      accommodation: "Accommodation quantities submitted with registrations; this module does not store separate hotel bookings.",
      enquiries: "Contact form submissions and brochure requests."
    };
    el("sub-title").textContent = labels[view];
    el("sub-description").textContent = descriptions[view];
    el("submission-state").hidden = false;
    el("submission-state").textContent = "Loading records...";
    el("empty").hidden = true;
    el("tbody").innerHTML = "";
    currentTableItems = [];
    var endpoint = view === "abstracts" ? "/admin/api/submissions/abstract" :
      (view === "enquiries" ? "/admin/api/submissions" : "/admin/api/submissions/register");
    api(endpoint).then(function (j) {
      if (!j || !j.ok) throw new Error("The server returned an invalid submissions response.");
      var items = j.items || [];
      if (view === "enquiries") {
        cache.contact = items.filter(function (item) { return item.kind === "contact"; });
        cache.brochure = items.filter(function (item) { return item.kind === "brochure"; });
        currentTableItems = cache.contact.concat(cache.brochure);
      } else {
        var kind = view === "abstracts" ? "abstract" : "register";
        cache[kind] = items;
        currentTableItems = view === "accommodation" ? items.filter(function (record) {
          return Number(d(record, "qty_accom_single")) > 0 || Number(d(record, "qty_accom_double")) > 0;
        }) : items;
      }
      el("submission-state").hidden = true;
      renderCurrentTable();
    }).catch(function (err) {
      if (err.message !== "unauth") {
        el("submission-state").hidden = false;
        el("submission-state").textContent = "Records could not be loaded. Refresh to try again.";
        toast("Could not load " + labels[view].toLowerCase(), true);
      }
    });
  }

  function renderCurrentTable() {
    if (SUBMISSION_VIEWS.indexOf(current) < 0) return;
    var items = currentTableItems.slice();
    var query = el("submission-search").value.trim().toLowerCase();
    var status = el("submission-status").value;
    var sort = el("submission-sort").value;
    var statuses = [];
    currentTableItems.forEach(function (record) {
      var value = record.paymentStatus || record.status || "New";
      if (statuses.indexOf(value) < 0) statuses.push(value);
    });
    statuses.sort();
    var statusSelect = el("submission-status");
    var selectedStatus = statusSelect.value;
    statusSelect.innerHTML = '<option value="">All statuses</option>' + statuses.map(function (value) {
      return '<option value="' + esc(value) + '">' + esc(value) + "</option>";
    }).join("");
    statusSelect.value = statuses.indexOf(selectedStatus) > -1 ? selectedStatus : "";
    status = statusSelect.value;
    items = items.filter(function (record) {
      var recordStatus = record.paymentStatus || record.status || "New";
      var searchable = [record.reference, record.kind, recordStatus, record.adminNotes, JSON.stringify(record.data || {})].join(" ").toLowerCase();
      return (!query || searchable.indexOf(query) > -1) && (!status || recordStatus === status);
    });
    items.sort(function (a, b) {
      if (sort === "name") {
        var aName = d(a, "fullName") || d(a, "authorName") || d(a, "title") || "";
        var bName = d(b, "fullName") || d(b, "authorName") || d(b, "title") || "";
        return String(aName).localeCompare(String(bName));
      }
      var delta = String(a.receivedAt || "").localeCompare(String(b.receivedAt || ""));
      return sort === "oldest" ? delta : -delta;
    });
    renderTable(current, items);
  }

  function renderTable(view, items) {
    var kind = view === "abstracts" ? "abstract" : "register";
    var cols;
    if (view === "accommodation") {
      cols = [
        { h: "Reference", f: function (r) { return '<span class="a-ref">' + esc(r.reference) + "</span>"; } },
        { h: "Registrant", f: function (r) { return esc(d(r, "fullName")); } },
        { h: "Single nights", f: function (r) { return esc(d(r, "qty_accom_single") || "0"); } },
        { h: "Double nights", f: function (r) { return esc(d(r, "qty_accom_double") || "0"); } },
        { h: "Payment", f: function (r) { return paySelect(r); } },
        { h: "Received", f: function (r) { return '<span class="a-sub">' + esc(fmt(r.receivedAt)) + "</span>"; } }
      ];
    } else if (view === "enquiries") {
      cols = [
        { h: "Type", f: function (r) { return esc(KIND_LABEL[r.kind] || r.kind); } },
        { h: "Reference", f: function (r) { return '<span class="a-ref">' + esc(r.reference) + "</span>"; } },
        { h: "Name", f: function (r) { return esc(d(r, "fullName")); } },
        { h: "Email", f: function (r) { return esc(d(r, "email")); } },
        { h: "Subject / Organization", f: function (r) { return esc(d(r, "subject") || d(r, "organization")); } },
        { h: "Status", f: function (r) { return statusPill(r); } },
        { h: "Received", f: function (r) { return '<span class="a-sub">' + esc(fmt(r.receivedAt)) + "</span>"; } }
      ];
    } else {
      cols = COLS[kind];
    }
    if (!cols) return;
    el("thead").innerHTML = "<tr>" + cols.map(function (c) { return "<th>" + c.h + "</th>"; }).join("") + "</tr>";
    el("empty").hidden = items.length > 0;
    el("empty").textContent = currentTableItems.length ? "No records match the selected search and filters." : "No records yet.";
    el("tbody").innerHTML = items.map(function (r) {
      return '<tr data-ref="' + esc(r.reference) + '" data-kind="' + esc(r.kind || kind) + '">' +
        cols.map(function (c) { return "<td>" + c.f(r) + "</td>"; }).join("") + "</tr>";
    }).join("");
  }

  // Delegated events on table body
  el("tbody").addEventListener("click", function (e) {
    if (e.target.closest("select") || e.target.closest("button")) return;
    var tr = e.target.closest("tr[data-ref]"); if (!tr) return;
    openDrawer(tr.getAttribute("data-kind") || current, tr.getAttribute("data-ref"));
  });

  /* ---------- Detail drawer ---------- */
  var drawerRef = null, drawerKind = null, drawerRecord = null;

  function openDrawer(kind, ref) {
    var items = cache[kind] || [];
    var rec = items.filter(function (x) { return x.reference === ref; })[0];
    if (!rec) return;
    drawerRef = ref; drawerKind = kind; drawerRecord = rec;
    el("d-title").textContent = (KIND_LABEL[kind] || kind).replace(/s$/, "") + " · " + ref;

    var data = rec.data || {};
    var ctrls = "<h4>Submission details</h4><p class='a-muted'>" +
      (kind === "register" ? "Registration and pricing details are read-only; use Admin notes for corrections." :
        "Edit submitted form data. Changes are stored in the backend.") + "</p>";
    Object.keys(data).forEach(function (key) {
      var value = data[key];
      var label = key.replace(/([A-Z])/g, " $1").replace(/_/g, " ");
      if (kind === "register") {
        ctrls += field(label, "<div class='a-readonly'>" + esc(value) + "</div>");
      } else if (typeof value === "boolean") {
        ctrls += field(label, "<label class='switch'><input type='checkbox' data-submission-field='" + esc(key) +
          "'" + (value ? " checked" : "") + "> Yes</label>");
      } else if (typeof value === "number") {
        ctrls += field(label, "<input class='a-input' type='number' step='any' data-submission-field='" + esc(key) +
          "' value='" + esc(value) + "'>");
      } else if (/abstract|message|address|items/i.test(key) || String(value).length > 160) {
        ctrls += field(label, "<textarea class='a-input' data-submission-field='" + esc(key) + "'>" + esc(value) + "</textarea>");
      } else {
        var inputType = /email/i.test(key) ? "email" : "text";
        ctrls += field(label, "<input class='a-input' type='" + inputType + "' data-submission-field='" + esc(key) +
          "' value='" + esc(value) + "'>");
      }
    });
    if (rec.attachment && kind === "abstract") {
      var attachmentUrl = "/admin/api/submissions/" + encodeURIComponent(kind) + "/" +
        encodeURIComponent(ref) + "/attachment";
      ctrls += field("Uploaded document", "<a class='a-btn sm' href='" + attachmentUrl +
        "' target='_blank' rel='noopener'>" + esc(rec.attachment.originalName || "Download document") + " · Download</a>" +
        "<div class='a-sub'>" + (Number(rec.attachment.size) / (1024 * 1024)).toFixed(2) + " MB</div>");
    }
    ctrls += field("Received", "<div class='a-readonly'>" + esc(fmt(rec.receivedAt)) + "</div>");
    if (rec.ip) ctrls += field("IP address", "<div class='a-readonly'>" + esc(rec.ip) + "</div>");
    if (kind === "register") {
      var isManualBankTransfer = (data.paymentGateway || data.paymentMethod) === "Bank Transfer" &&
        (rec.paymentStatus || "Pending") === "Pending";
      ctrls += field("Payment status", isManualBankTransfer
        ? selectHtml("d-pay", BANK_PAYMENT_STATUSES, rec.paymentStatus || "Pending")
        : "<div class='a-readonly'>" + esc(rec.paymentStatus || "Pending") + "</div>");
      if (isManualBankTransfer) {
        ctrls += field("Payment verification reference or cancellation reason",
          "<input class='a-input' id='d-payment-evidence' type='text' maxlength='200' autocomplete='off'>");
      } else if (rec.paymentVerification && rec.paymentVerification.evidence) {
        ctrls += field("Manual payment verification", "<div class='a-readonly'>" +
          esc(rec.paymentVerification.outcome) + " · " + esc(rec.paymentVerification.evidence) + "</div>");
      }
      ctrls += field("Payment amount (" + esc(rec.amountCurrency || rec.transactionCurrency || "EUR") + ")",
        "<div class='a-readonly'>" + esc(money(rec.amount, rec.amountCurrency || rec.transactionCurrency || "EUR")) + "</div>");
    }
    ctrls += field("Review status", selectHtml("d-status", STATUS, rec.status || "New"));
    ctrls += field("Admin notes", "<textarea class='a-input' id='d-notes'>" + esc(rec.adminNotes || "") + "</textarea>");
    ctrls += "<div style='display:flex;gap:.6rem;margin-top:1rem'>" +
      "<button class='a-btn' id='d-save'>Save</button>" +
      "<button class='a-btn danger' id='d-del'>Delete</button></div>";

    el("d-body").innerHTML = ctrls;
    el("drawer").classList.add("open");
    el("drawer-bg").classList.add("open");
    el("d-save").addEventListener("click", saveDrawer);
    el("d-del").addEventListener("click", deleteDrawer);
  }

  function field(label, inner) { return "<div class='a-field'><label>" + label + "</label>" + inner + "</div>"; }
  function selectHtml(id, opts, val) {
    return "<select class='a-select' id='" + id + "' data-kind='" + esc(drawerKind) + "'>" + opts.map(function (o) {
      return "<option" + (o === val ? " selected" : "") + ">" + o + "</option>";
    }).join("") + "</select>";
  }

  function closeDrawer() {
    el("drawer").classList.remove("open");
    el("drawer-bg").classList.remove("open");
    drawerRef = null; drawerKind = null; drawerRecord = null;
  }
  el("d-close").addEventListener("click", closeDrawer);
  el("drawer-bg").addEventListener("click", closeDrawer);

  function saveDrawer() {
    if (!drawerRef) return;
    var data = {};
    if (drawerKind !== "register") document.querySelectorAll("#d-body [data-submission-field]").forEach(function (input) {
      var key = input.getAttribute("data-submission-field");
      if (input.type === "checkbox") data[key] = input.checked;
      else if (input.type === "number") data[key] = input.value === "" ? "" : Number(input.value);
      else data[key] = input.value;
    });
    var body = { adminNotes: el("d-notes").value, status: el("d-status").value };
    if (drawerKind !== "register") body.data = data;
    if (drawerKind === "register" && el("d-pay")) {
      var paymentStatus = el("d-pay").value;
      if (paymentStatus !== (drawerRecord.paymentStatus || "Pending")) {
        var evidence = el("d-payment-evidence").value.trim();
        if (!evidence) { toast("Enter the bank verification reference or cancellation reason", true); return; }
        body.paymentStatus = paymentStatus;
        body.paymentEvidence = evidence;
      }
    }
    api("/admin/api/submissions/" + encodeURIComponent(drawerKind) + "/" + encodeURIComponent(drawerRef), {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    }).then(function (j) {
      if (j && j.ok) { toast("Saved"); closeDrawer(); loadAll(); }
      else toast("Save failed", true);
    }).catch(function () { toast("Save failed", true); });
  }

  function deleteDrawer() {
    if (!drawerRef) return;
    if (!confirm("Delete this record permanently?")) return;
    api("/admin/api/submissions/" + encodeURIComponent(drawerKind) + "/" + encodeURIComponent(drawerRef), { method: "DELETE" })
      .then(function (j) {
        if (j && j.ok) { toast("Deleted"); closeDrawer(); loadAll(); }
        else toast("Delete failed", true);
      }).catch(function () { toast("Delete failed", true); });
  }

  /* ---------- Site content editor ---------- */
  var FEE_PERIODS = ["Early Bird", "Mid-Term", "On-Spot"];
  var FEE_CATS = ["Speaker", "Delegate", "Poster", "Student", "Virtual"];

  function loadContent() {
    el("management-state").hidden = false;
    el("management-state").textContent = "Loading saved website settings...";
    api("/api/content").then(function (j) {
      if (!j || !j.content) throw new Error("The server returned an invalid website settings response.");
      contentData = j.content;
      fillContent(contentData);
      el("management-state").hidden = true;
    }).catch(function (err) {
      if (err.message !== "unauth") {
        el("management-state").hidden = false;
        el("management-state").textContent = "Saved settings could not be loaded. Refresh to try again.";
        toast("Could not load website settings", true);
      }
    });
  }

  function fillContent(c) {
    c = c || {};
    var b = c.banner || {}, s = c.site || {};
    el("c-banner-on").checked = !!b.enabled;
    el("c-banner-text").value = b.text || "";
    el("c-theme").value = s.theme || "";
    el("c-dates").value = s.dateText || "";
    el("c-city").value = s.city || "";
    el("c-map-url").value = s.mapUrl || "";
    renderDates(c.dates || []);
    renderHomeGallery(c.homeGallery || {});
    renderFees(c.fees || {});
    renderPeriods(c.registrationPeriods || {});
    renderFixedPrices(c.registrationPricing || {});
    renderCoupons(c.coupons || []);
    renderMedia(c.media || {});
    renderPageList();
    renderMembers(c.committee || []);
    renderSpeakers(c.speakers || []);
  }

  function renderDates(dates) {
    el("dates-list").innerHTML = dates.length ? dates.map(function (dt, i) {
      return "<div class='a-row' data-date='" + i + "'>" +
        "<input class='a-input' data-df='label' value='" + esc(dt.label) + "' placeholder='Label'>" +
        "<input class='a-input' data-df='value' value='" + esc(dt.value) + "' placeholder='Value'>" +
        "<button class='a-btn ghost sm' data-rmdate='" + i + "'>Remove</button></div>";
    }).join("") : "<p class='a-empty a-empty-inline'>No important dates configured.</p>";
  }

  function renderMedia(media) {
    var list = el("media-list");
    if (!list) return;
    list.innerHTML = MEDIA_ITEMS.map(function (item) {
      var path = media[item.key] || item.defaultPath;
      return "<article class='a-media-card' data-media-item='" + esc(item.key) + "'><img src='" + esc(path) + "' alt='" + esc(item.name) + " preview' data-media-preview><div class='a-media-meta'><span class='a-media-location'>" + esc(item.page) + " · " + esc(item.section) + "</span><h3>" + esc(item.name) + "</h3><p class='a-sub'>" + esc(path) + "</p><div class='a-media-actions'><label class='a-btn ghost sm'>Replace image<input type='file' accept='image/jpeg,image/png,image/webp,image/gif' data-media-file hidden></label><button class='a-btn ghost sm' type='button' data-media-restore>Restore default</button></div><input type='hidden' data-media-path value='" + esc(media[item.key] || "") + "'><span class='a-sub' data-media-status>" + (media[item.key] ? "Custom image in use" : "Original image in use") + "</span></div></article>";
    }).join("");
    el("media-search").value = "";
    filterItems("media-list", "[data-media-item]", "media-search", "media-no-results");
  }

  function filterItems(listId, selector, searchId, emptyId) {
    var query = el(searchId).value.trim().toLowerCase();
    var visible = 0;
    var items = el(listId).querySelectorAll(selector);
    items.forEach(function (item) {
      var fields = Array.prototype.map.call(item.querySelectorAll("input,textarea,select"), function (field) {
        return field.value || (field.options && field.options[field.selectedIndex] ? field.options[field.selectedIndex].text : "");
      }).join(" ");
      var matches = !query || (item.textContent + " " + fields).toLowerCase().indexOf(query) > -1;
      item.style.display = matches ? "" : "none";
      if (matches) visible++;
    });
    el(emptyId).hidden = !query || items.length === 0 || visible > 0;
  }
  el("media-search").addEventListener("input", function () {
    filterItems("media-list", "[data-media-item]", "media-search", "media-no-results");
  });

  el("media-list").addEventListener("click", function (e) {
    var restore = e.target.closest("[data-media-restore]"); if (!restore) return;
    var card = restore.closest("[data-media-item]");
    var item = MEDIA_ITEMS.filter(function (x) { return x.key === card.getAttribute("data-media-item"); })[0];
    if (card.querySelector("[data-media-path]").value &&
        !window.confirm("Restore the original image for " + item.name + "? Save media changes to publish it.")) return;
    card.querySelector("[data-media-path]").value = "";
    card.querySelector("[data-media-preview]").src = item.defaultPath;
    card.querySelector("[data-media-status]").textContent = "Original image will be restored when saved.";
  });
  el("media-list").addEventListener("change", function (e) {
    var input = e.target.closest("[data-media-file]"); if (!input || !input.files || !input.files[0]) return;
    var card = input.closest("[data-media-item]"), status = card.querySelector("[data-media-status]");
    var formData = new FormData(); formData.append("image", input.files[0]); status.textContent = "Uploading image…";
    api("/admin/api/upload-image", { method: "POST", body: formData }).then(function (result) {
      if (!result || !result.path) throw new Error("The uploaded image path was not returned.");
      card.querySelector("[data-media-path]").value = result.path; card.querySelector("[data-media-preview]").src = result.path;
      status.textContent = "Replacement uploaded. Save media changes to publish it.";
    }).catch(function (err) { status.textContent = err.message || "Upload failed."; toast(status.textContent, true); }).finally(function () { input.value = ""; });
  });
  el("save-media").addEventListener("click", function () { saveContent(); });

  el("dates-list").addEventListener("click", function (e) {
    var rm = e.target.closest("[data-rmdate]"); if (!rm) return;
    if (!window.confirm("Remove this important date? Save changes to publish the removal.")) return;
    rm.closest("[data-date]").remove();
  });
  el("add-date").addEventListener("click", function () {
    var box = document.createElement("div");
    box.className = "a-row"; box.setAttribute("data-date", "new");
    box.innerHTML = "<input class='a-input' data-df='label' placeholder='Label'>" +
      "<input class='a-input' data-df='value' placeholder='Value'>" +
      "<button class='a-btn ghost sm' data-rmdate='x'>Remove</button>";
    el("dates-list").appendChild(box);
  });

  function renderHomeGallery(gallery) {
    gallery = gallery || {};
    el("c-home-gallery-heading").value = gallery.heading || "";
    var photos = Array.isArray(gallery.photos) ? gallery.photos : [];
    el("home-gallery-photos").innerHTML = photos.map(function (photo, i) {
      return "<div class='a-row home-gallery-admin-row' data-gallery-photo='" + i + "'>" +
        imageUploadField("gf", photo) +
        "<button class='a-btn ghost sm' type='button' data-remove-gallery-photo>Remove photo</button></div>";
    }).join("");
  }

  el("add-home-gallery-photo").addEventListener("click", function () {
    var box = document.createElement("div");
    box.className = "a-row home-gallery-admin-row";
    box.setAttribute("data-gallery-photo", "new");
    box.innerHTML = imageUploadField("gf", "") +
      "<button class='a-btn ghost sm' type='button' data-remove-gallery-photo>Remove photo</button>";
    el("home-gallery-photos").appendChild(box);
  });
  el("clear-home-gallery-heading").addEventListener("click", function () {
    if (el("c-home-gallery-heading").value.trim() &&
        !window.confirm("Remove the homepage highlights heading? Save changes to publish the removal.")) return;
    el("c-home-gallery-heading").value = "";
  });
  el("clear-home-gallery-photos").addEventListener("click", function () {
    if (el("home-gallery-photos").children.length &&
        !window.confirm("Remove all homepage photos? Save changes to publish the removal.")) return;
    el("home-gallery-photos").innerHTML = "";
  });
  el("home-gallery-photos").addEventListener("click", function (e) {
    var remove = e.target.closest("[data-remove-gallery-photo]");
    if (remove && window.confirm("Remove this homepage photo? Save changes to publish the removal.")) {
      remove.closest("[data-gallery-photo]").remove();
    }
    handleImageUploadEvent(e, el("home-gallery-photos"), "gf");
  });
  el("home-gallery-photos").addEventListener("change", function (e) {
    handleImageUploadEvent(e, el("home-gallery-photos"), "gf");
  });
  function renderFees(fees) {
    var head = "<tr><th>Period</th>" + FEE_CATS.map(function (c) { return "<th>" + c + "</th>"; }).join("") + "</tr>";
    var rows = FEE_PERIODS.map(function (p) {
      var row = fees[p] || {};
      return "<tr><td>" + (p === "On-Spot" ? "Late" : p) + "</td>" + FEE_CATS.map(function (c) {
        return "<td><input type='number' data-fee='" + esc(p) + "|" + c + "' value='" + esc(row[c] != null ? row[c] : 0) + "'></td>";
      }).join("") + "</tr>";
    }).join("");
    el("fees-table").innerHTML = head + rows;
  }

  function renderPeriods(periods) {
    var active = periods.active || "Early Bird";
    el("reg-active").innerHTML = FEE_PERIODS.map(function (p) {
      var label = p === "On-Spot" ? "Late" : p;
      return "<option value='" + esc(p) + "'" + (p === active ? " selected" : "") + ">" + esc(label) + "</option>";
    }).join("");
    el("periods-list").innerHTML = FEE_PERIODS.map(function (p) {
      var row = periods[p] || {};
      var deadline = /^\d{4}-\d{2}-\d{2}$/.test(row.deadline || "") ? row.deadline : "";
      var periodTitle = p === "On-Spot" ? "Late" : p;
      var defaultLabel = p === "On-Spot" ? "Late Registration" : p;
      var periodLabel = row.label || defaultLabel;
      if (p === "On-Spot" && periodLabel === "On-spot Registration") periodLabel = defaultLabel;
      return "<div class='a-period' data-period='" + esc(p) + "'>" +
        "<div class='a-row'><label style='width:90px;color:var(--a-muted);font-size:.8rem'>" + esc(periodTitle) + "</label>" +
        "<input class='a-input' data-pf='label' value='" + esc(periodLabel) + "' placeholder='Display label'>" +
        "<label class='a-date-field'>Deadline<input class='a-input' data-pf='deadline' type='date' value='" + deadline + "'></label></div></div>";
    }).join("");
  }

  function renderFixedPrices(pricing) {
    var prices = pricing.fixedItems || {};
    var rows = FIXED_PRICE_ITEMS.map(function (item) {
      var value = prices[item[0]];
      return "<tr><td>" + esc(item[1]) + "</td><td><label class='a-price-input'><span>$</span>" +
        "<input type='number' min='0' step='0.01' data-fixed-price='" + esc(item[0]) +
        "' value='" + esc(value != null ? value : 0) + "' aria-label='" + esc(item[1]) + " price'></label></td></tr>";
    }).join("");
    el("item-prices").innerHTML = "<thead><tr><th>Registration item</th><th>Price (USD)</th></tr></thead><tbody>" + rows + "</tbody>";
  }

  function renderCoupons(coupons) {
    el("coupons-list").innerHTML = (Array.isArray(coupons) ? coupons : []).map(function (coupon, i) {
      coupon = coupon || {};
      return "<div class='a-row a-coupon' data-coupon='" + i + "'>" +
        "<label class='switch'><input type='checkbox' data-cf='enabled'" + (coupon.enabled === false ? "" : " checked") + "> Enabled</label>" +
        "<input class='a-input' data-cf='code' value='" + esc(coupon.code || "") + "' placeholder='Coupon code' aria-label='Coupon code'>" +
        "<label class='a-percent'><input class='a-input' data-cf='percent' type='number' min='1' max='100' step='1' value='" +
        esc(coupon.percent != null ? coupon.percent : 10) + "' aria-label='Discount percentage'> % off</label>" +
        "<button class='a-btn ghost sm' data-remove-coupon type='button'>Remove</button></div>";
    }).join("") || "<p class='a-empty'>No coupons configured.</p>";
  }

  el("coupons-list").addEventListener("click", function (e) {
    var remove = e.target.closest("[data-remove-coupon]");
    if (remove && window.confirm("Remove this coupon? Save changes to publish the removal.")) {
      remove.closest("[data-coupon]").remove();
      if (!el("coupons-list").querySelector("[data-coupon]")) {
        el("coupons-list").innerHTML = "<p class='a-empty'>No coupons configured.</p>";
      }
    }
  });
  el("add-coupon").addEventListener("click", function () {
    var coupons = readCoupons();
    coupons.push({ code: "", percent: 10, enabled: true });
    renderCoupons(coupons);
  });
  function readCoupons() {
    return Array.prototype.map.call(document.querySelectorAll("#coupons-list [data-coupon]"), function (row) {
      var field = function (name) { return row.querySelector("[data-cf='" + name + "']"); };
      return {
        code: field("code").value.trim().toUpperCase(),
        percent: Number(field("percent").value) || 0,
        enabled: field("enabled").checked
      };
    }).filter(function (coupon) { return coupon.code; });
  }

  function renderPageList() {
    var list = el("page-list");
    if (!list) return;
    list.innerHTML = PAGE_FILES.map(function (p) {
      return "<button class='a-page-link' type='button' data-open-page='" + esc(p.href) + "'><span>" + esc(p.label) + "</span><b>Open page →</b></button>";
    }).join("");
  }

  el("page-list").addEventListener("click", function (e) {
    var button = e.target.closest("[data-open-page]");
    if (!button) return;
    currentEditPage = button.getAttribute("data-open-page");
    var page = PAGE_FILES.find(function (p) { return p.href === currentEditPage; });
    el("page-editor-title").textContent = "Edit " + (page ? page.label : "Website Page");
    el("pages-index").style.display = "none";
    el("page-editor-view").style.display = "block";
    el("main-title").textContent = page ? page.label : "Edit Website Page";
    loadPageEditor(currentEditPage);
  });
  el("back-to-pages").addEventListener("click", function () {
    el("page-editor-view").style.display = "none";
    el("pages-index").style.display = "block";
    el("main-title").textContent = "Website Pages";
    renderPageList();
  });

  function loadPageEditor(page) {
    currentEditPage = page || currentEditPage;
    var box = el("page-sections-editor");
    if (!box) return;
    box.innerHTML = "<p class='a-sub'>Loading page sections...</p>";
    fetch(currentEditPage)
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, "text/html");
        var sections = Array.prototype.slice.call(doc.querySelectorAll("body > section, body > main > section")).filter(function (section) {
          return !section.classList.contains("page-section-picker") && !section.classList.contains("abstract-section-picker");
        });
        var saved = ((contentData && contentData.pages && contentData.pages[currentEditPage]) || {});
        if (!sections.length) {
          box.innerHTML = "<p class='a-empty'>No editable content sections found on this page.</p>";
          return;
        }
        var sectionHtml = sections.map(function (section, i) {
          var key = "sec-" + i;
          var titleEl = section.querySelector("h2,h3,.eyebrow,p.lead");
          var title = titleEl ? titleEl.textContent.trim() : ("Section " + (i + 1));
          var currentHtml = saved[key] && saved[key].html != null ? saved[key].html : section.innerHTML.trim();
          var deleted = saved[key] && saved[key].deleted;
          return "<div class='a-page-section" + (deleted ? " is-deleted" : "") + "' data-sec='" + key + "'" + (deleted ? " data-deleted='true'" : "") + ">" +
            "<div class='a-row section-title'><strong>" + esc(title || ("Section " + (i + 1))) + "</strong>" +
            "<div class='a-action-buttons'><button class='a-btn ghost sm' data-reset-section='" + key + "' type='button'>Use Original</button>" +
            "<button class='a-btn ghost sm' data-remove-section type='button'>Remove Section</button>" +
            "<button class='a-btn ghost sm' data-restore-section type='button'>Undo Remove</button>" +
            "<button class='a-btn ghost sm' data-toggle-html type='button'>Edit HTML</button></div></div>" +
            "<div class='a-input page-html' contenteditable='true' data-original='" + esc(section.innerHTML.trim()) + "'>" + currentHtml + "</div>" +
            "<textarea class='a-input page-html-source' rows='12' hidden>" + esc(currentHtml) + "</textarea>" +
          "</div>";
        }).join("");
        var addedKeys = Object.keys(saved).filter(function (key) {
          var index = Number(key.replace(/^sec-/, ""));
          return /^sec-\d+$/.test(key) && index >= sections.length;
        }).sort(function (a, b) {
          return Number(a.slice(4)) - Number(b.slice(4));
        });
        sectionHtml += addedKeys.map(function (key) {
          return addedSectionEditor(key, saved[key] && saved[key].html || "");
        }).join("");
        box.setAttribute("data-original-section-count", String(sections.length));
        box.innerHTML = sectionHtml;
      })
      .catch(function () {
        box.innerHTML = "<p class='a-empty'>Could not load this page for editing.</p>";
      });
  }
  el("page-sections-editor").addEventListener("click", function (e) {
    var toggle = e.target.closest("[data-toggle-html]");
    if (toggle) {
      var toggleRow = toggle.closest("[data-sec]");
      var visualEditor = toggleRow && toggleRow.querySelector(".page-html");
      var sourceEditor = toggleRow && toggleRow.querySelector(".page-html-source");
      if (visualEditor && sourceEditor) {
        if (sourceEditor.hidden) {
          sourceEditor.value = visualEditor.innerHTML;
          visualEditor.hidden = true;
          sourceEditor.hidden = false;
          toggle.textContent = "Visual Edit";
        } else {
          visualEditor.innerHTML = sourceEditor.value;
          sourceEditor.hidden = true;
          visualEditor.hidden = false;
          toggle.textContent = "Edit HTML";
        }
      }
      return;
    }
    var btn = e.target.closest("[data-reset-section]");
    if (btn) {
      var wrap = btn.closest("[data-sec]");
      var editor = wrap && wrap.querySelector("[contenteditable]");
      if (editor) {
        editor.innerHTML = editor.getAttribute("data-original") || "";
        var source = wrap.querySelector(".page-html-source");
        if (source) source.value = editor.innerHTML;
      }
      return;
    }
    var restore = e.target.closest("[data-restore-section]");
    if (restore) {
      var restoreRow = restore.closest("[data-sec]");
      if (restoreRow) { restoreRow.removeAttribute("data-deleted"); restoreRow.classList.remove("is-deleted"); }
      return;
    }
    var remove = e.target.closest("[data-remove-section]");
    if (remove) {
      var removeRow = remove.closest("[data-sec]");
      if (removeRow && Number(removeRow.getAttribute("data-sec").slice(4)) <
          Number(el("page-sections-editor").getAttribute("data-original-section-count") || 0)) {
        removeRow.setAttribute("data-deleted", "true");
        removeRow.classList.add("is-deleted");
      } else if (removeRow) removeRow.remove();
    }
  });

  function addedSectionEditor(key, html) {
    return "<div class='a-page-section' data-sec='" + esc(key) + "'>" +
      "<div class='a-row section-title'><strong>Added Section</strong>" +
      "<div class='a-action-buttons'><button class='a-btn ghost sm' data-remove-section type='button'>Remove Section</button>" +
      "<button class='a-btn ghost sm' data-toggle-html type='button'>Edit HTML</button></div></div>" +
      "<div class='a-input page-html' contenteditable='true' data-original=''>" + html + "</div>" +
      "<textarea class='a-input page-html-source' rows='12' hidden>" + esc(html) + "</textarea>" +
      "</div>";
  }

  el("add-section").addEventListener("click", function () {
    var box = el("page-sections-editor");
    if (!box) return;
    var maxIndex = -1;
    box.querySelectorAll("[data-sec]").forEach(function (section) {
      var index = Number(section.getAttribute("data-sec").slice(4));
      if (isFinite(index)) maxIndex = Math.max(maxIndex, index);
    });
    box.insertAdjacentHTML("beforeend", addedSectionEditor("sec-" + (maxIndex + 1), ""));
    box.lastElementChild.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  el("init-defaults").addEventListener("click", function () {
    if (!currentEditPage || !window.confirm("Restore this page to its original content? Saved edits for this page will be removed.")) return;
    var payload = Object.assign({}, contentData || {});
    payload.pages = Object.assign({}, payload.pages || {});
    delete payload.pages[currentEditPage];
    api("/admin/api/content", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: payload })
    }).then(function (result) {
      if (!result || !result.ok) throw new Error("Could not restore the default page content");
      contentData = result.content || payload;
      loadPageEditor(currentEditPage);
      notifySiteContentChanged();
      toast("Page restored to original content");
    }).catch(function (err) {
      if (err.message !== "unauth") toast(err.message || "Could not restore defaults", true);
    });
  });

  /* ---------- Committee members editor ---------- */
  var COMMITTEE_GROUPS = ["Scientific Committee", "International Advisory Committee"];

  function imageUploadField(prefix, photo) {
    var safePhoto = /^(https?:\/\/|\/|\.\.?\/)/i.test(String(photo || "")) ? String(photo) : "";
    return "<div class='a-image-upload' data-image-upload>" +
      "<div class='a-image-preview'>" +
        "<img data-image-preview src=\"" + esc(safePhoto) + "\" alt=\"Selected profile photo\"" + (safePhoto ? "" : " hidden") + ">" +
        "<span data-image-empty" + (safePhoto ? " hidden" : "") + ">No image selected</span>" +
      "</div>" +
      "<div class='a-image-controls'><label class='a-btn ghost sm'>Upload image<input type='file' accept='image/jpeg,image/png,image/gif,image/webp' data-image-file hidden></label>" +
        "<button class='a-btn ghost sm' type='button' data-clear-image>Remove image</button><span class='a-sub' data-image-status>JPEG, PNG, GIF, or WebP; up to 5 MB</span></div>" +
      "<input type='hidden' data-" + prefix + "='photo' value=\"" + esc(photo || "") + "\">" +
    "</div>";
  }

  function handleImageUploadEvent(e, list, prefix) {
    var clear = e.target.closest("[data-clear-image]");
    if (clear) {
      if (!window.confirm("Remove this profile image? Save changes to publish the removal.")) return;
      var clearBox = clear.closest("[data-image-upload]");
      clearBox.querySelector("[data-" + prefix + "='photo']").value = "";
      clearBox.querySelector("[data-image-preview]").hidden = true;
      clearBox.querySelector("[data-image-preview]").removeAttribute("src");
      clearBox.querySelector("[data-image-empty]").hidden = false;
      clearBox.querySelector("[data-image-status]").textContent = "Image removed. Save to publish this change.";
      return;
    }
    var fileInput = e.target.closest("[data-image-file]");
    if (!fileInput || !fileInput.files || !fileInput.files[0]) return;
    var box = fileInput.closest("[data-image-upload]");
    var status = box.querySelector("[data-image-status]");
    var formData = new FormData();
    formData.append("image", fileInput.files[0]);
    status.textContent = "Uploading image...";
    api("/admin/api/upload-image", { method: "POST", body: formData }).then(function (result) {
      var path = result && result.path;
      if (!path) throw new Error("The uploaded image path was not returned.");
      box.querySelector("[data-" + prefix + "='photo']").value = path;
      var preview = box.querySelector("[data-image-preview]");
      preview.src = path;
      preview.hidden = false;
      box.querySelector("[data-image-empty]").hidden = true;
      status.textContent = "Image uploaded. Save to publish it.";
    }).catch(function (err) {
      if (err.message !== "unauth") {
        status.textContent = err.message || "Image upload failed.";
        toast(status.textContent, true);
      }
    }).finally(function () { fileInput.value = ""; });
  }

  function memberRow(m) {
    m = m || {};
    var opts = COMMITTEE_GROUPS.map(function (g) {
      return "<option value='" + esc(g) + "'" + (m.group === g ? " selected" : "") + ">" + esc(g) + "</option>";
    }).join("");
    var box = document.createElement("div");
    box.className = "a-member"; box.setAttribute("data-member", "1");
    box.innerHTML =
      "<div class='a-row'>" +
        "<select class='a-input' data-mf='group' style='max-width:240px'>" + opts + "</select>" +
        "<input class='a-input' data-mf='name' value='" + esc(m.name || "") + "' placeholder='Full name (e.g. Prof. Jane Doe)'>" +
        "<button class='a-btn ghost sm' data-rmmember='1'>Remove</button>" +
      "</div>" +
      "<div class='a-row'>" +
        "<input class='a-input' data-mf='role' value='" + esc(m.role || "") + "' placeholder='Role / Department / Research area'>" +
        "<input class='a-input' data-mf='org' value='" + esc(m.org || "") + "' placeholder='Institution — Country'>" +
      "</div>" +
      imageUploadField("mf", m.photo) +
      "<div class='a-row'>" +
        "<textarea class='a-input' data-mf='bio' rows='2' placeholder='Short biography (optional)'>" + esc(m.bio || "") + "</textarea>" +
      "</div>";
    return box;
  }

  function renderMembers(members) {
    var list = el("members-list");
    list.innerHTML = "";
    (members || []).forEach(function (m) { list.appendChild(memberRow(m)); });
    if (!list.children.length) list.innerHTML = "<p class='a-empty a-empty-inline'>No committee members configured.</p>";
    el("committee-search").value = "";
    filterItems("members-list", "[data-member]", "committee-search", "committee-no-results");
  }
  el("committee-search").addEventListener("input", function () {
    filterItems("members-list", "[data-member]", "committee-search", "committee-no-results");
  });

  el("members-list").addEventListener("click", function (e) {
    var rm = e.target.closest("[data-rmmember]"); if (!rm) return;
    if (!window.confirm("Remove this committee member? Save changes to publish the removal.")) return;
    rm.closest("[data-member]").remove();
    if (!el("members-list").querySelector("[data-member]")) {
      el("members-list").innerHTML = "<p class='a-empty a-empty-inline'>No committee members configured.</p>";
    }
  });
  el("members-list").addEventListener("change", function (e) { handleImageUploadEvent(e, el("members-list"), "mf"); });
  el("members-list").addEventListener("click", function (e) { handleImageUploadEvent(e, el("members-list"), "mf"); });
  el("add-member").addEventListener("click", function () {
    var empty = el("members-list").querySelector(".a-empty");
    if (empty) empty.remove();
    el("members-list").appendChild(memberRow({ group: COMMITTEE_GROUPS[0] }));
  });

  /* ---------- Speakers editor ---------- */
  var SPEAKER_GROUPS = ["Keynote Speakers", "Plenary Speakers", "Featured / Invited Speakers"];

  function speakerRow(m) {
    m = m || {};
    var opts = SPEAKER_GROUPS.map(function (g) {
      return "<option value='" + esc(g) + "'" + (m.group === g ? " selected" : "") + ">" + esc(g) + "</option>";
    }).join("");
    var box = document.createElement("div");
    box.className = "a-member"; box.setAttribute("data-speaker", "1");
    box.innerHTML =
      "<div class='a-row'>" +
        "<select class='a-input' data-sf='group' style='max-width:240px'>" + opts + "</select>" +
        "<input class='a-input' data-sf='name' value='" + esc(m.name || "") + "' placeholder='Speaker name (e.g. Prof. Jane Doe)'>" +
        "<button class='a-btn ghost sm' data-rmspeaker='1'>Remove</button>" +
      "</div>" +
      "<div class='a-row'>" +
        "<input class='a-input' data-sf='role' value='" + esc(m.role || "") + "' placeholder='Title / Position / Research area'>" +
        "<input class='a-input' data-sf='org' value='" + esc(m.org || "") + "' placeholder='Institution / Organization — Country'>" +
      "</div>" +
      imageUploadField("sf", m.photo) +
      "<div class='a-row'>" +
        "<input class='a-input' data-sf='topic' value='" + esc(m.topic || "") + "' placeholder='Presentation / focus (optional)'>" +
      "</div>" +
      "<div class='a-row'>" +
        "<textarea class='a-input' data-sf='bio' rows='2' placeholder='Short biography (optional)'>" + esc(m.bio || "") + "</textarea>" +
      "</div>";
    return box;
  }

  function renderSpeakers(speakers) {
    var list = el("speakers-list");
    list.innerHTML = "";
    (speakers || []).forEach(function (m) { list.appendChild(speakerRow(m)); });
    if (!list.children.length) list.innerHTML = "<p class='a-empty a-empty-inline'>No speakers configured.</p>";
    el("speaker-search").value = "";
    filterItems("speakers-list", "[data-speaker]", "speaker-search", "speakers-no-results");
  }
  el("speaker-search").addEventListener("input", function () {
    filterItems("speakers-list", "[data-speaker]", "speaker-search", "speakers-no-results");
  });

  el("speakers-list").addEventListener("click", function (e) {
    var rm = e.target.closest("[data-rmspeaker]"); if (!rm) return;
    if (!window.confirm("Remove this speaker? Save changes to publish the removal.")) return;
    rm.closest("[data-speaker]").remove();
    if (!el("speakers-list").querySelector("[data-speaker]")) {
      el("speakers-list").innerHTML = "<p class='a-empty a-empty-inline'>No speakers configured.</p>";
    }
  });
  el("speakers-list").addEventListener("change", function (e) { handleImageUploadEvent(e, el("speakers-list"), "sf"); });
  el("speakers-list").addEventListener("click", function (e) { handleImageUploadEvent(e, el("speakers-list"), "sf"); });
  el("add-speaker").addEventListener("click", function () {
    var empty = el("speakers-list").querySelector(".a-empty");
    if (empty) empty.remove();
    el("speakers-list").appendChild(speakerRow({ group: SPEAKER_GROUPS[0] }));
  });

  function isGoogleMapsLocationUrl(value) {
    try {
      var parsed = new URL(value);
      var host = parsed.hostname.toLowerCase();
      return /^maps\.google\.[a-z.]+$/.test(host) ||
        host === "maps.app.goo.gl" || (host === "goo.gl" && /^\/maps\//.test(parsed.pathname)) ||
        ((host === "google.com" || host === "www.google.com" || /^(?:www\.)?google\.[a-z.]+$/.test(host)) &&
          /^\/maps(?:\/|$)/.test(parsed.pathname));
    } catch (_) { return false; }
  }
  function saveContent() {
    var mapUrl = el("c-map-url").value.trim();
    if (mapUrl && !isGoogleMapsLocationUrl(mapUrl)) {
      toast("Enter a valid Google Maps location link.", true);
      return;
    }
    var dates = [];
    document.querySelectorAll("#dates-list [data-date]").forEach(function (row) {
      var l = $("[data-df='label']", row).value.trim();
      var v = $("[data-df='value']", row).value.trim();
      if (l || v) dates.push({ label: l, value: v });
    });
    var homeGalleryPhotos = [];
    document.querySelectorAll("#home-gallery-photos [data-gallery-photo]").forEach(function (row) {
      var photo = $("[data-gf='photo']", row);
      if (photo && photo.value.trim()) homeGalleryPhotos.push(photo.value.trim());
    });
    var fees = {};
    FEE_PERIODS.forEach(function (p) { fees[p] = {}; });
    document.querySelectorAll("#fees-table [data-fee]").forEach(function (inp) {
      var parts = inp.getAttribute("data-fee").split("|");
      fees[parts[0]][parts[1]] = Number(inp.value) || 0;
    });
    var registrationPeriods = { active: el("reg-active").value || "Early Bird" };
    document.querySelectorAll("#periods-list [data-period]").forEach(function (row) {
      var p = row.getAttribute("data-period");
      var label = $("[data-pf='label']", row).value.trim();
      var deadline = $("[data-pf='deadline']", row).value.trim();
      registrationPeriods[p] = { label: label || p, deadline: deadline || "To Be Announced" };
    });
    var fixedItems = {};
    document.querySelectorAll("#item-prices [data-fixed-price]").forEach(function (inp) {
      fixedItems[inp.getAttribute("data-fixed-price")] = Math.max(0, Number(inp.value) || 0);
    });
    var media = {};
    document.querySelectorAll("#media-list [data-media-item]").forEach(function (row) {
      var customPath = row.querySelector("[data-media-path]").value.trim();
      if (customPath) media[row.getAttribute("data-media-item")] = customPath;
    });
    var pages = Object.assign({}, (contentData && contentData.pages) || {});
    var pageRows = document.querySelectorAll("#page-sections-editor [data-sec]");
    var editingPageNow = el("page-editor-view").style.display !== "none" && pageRows.length > 0;
    if (currentEditPage && editingPageNow) {
      pages[currentEditPage] = {};
      pageRows.forEach(function (row) {
        var key = row.getAttribute("data-sec");
        if (row.getAttribute("data-deleted") === "true") {
          pages[currentEditPage][key] = { deleted: true };
        } else {
          var sourceEditor = row.querySelector(".page-html-source");
          var visualEditor = row.querySelector("[contenteditable='true']");
          var html = sourceEditor && !sourceEditor.hidden
            ? sourceEditor.value : (visualEditor ? visualEditor.innerHTML : "");
          pages[currentEditPage][key] = { html: html };
        }
      });
    }
    var committee = [];
    document.querySelectorAll("#members-list [data-member]").forEach(function (row) {
      var mf = function (f) { var e = $("[data-mf='" + f + "']", row); return e ? e.value.trim() : ""; };
      var name = mf("name");
      if (!name) return; // skip empty rows
      committee.push({
        group: mf("group") || COMMITTEE_GROUPS[0],
        name: name, role: mf("role"), org: mf("org"),
        photo: mf("photo"), bio: mf("bio")
      });
    });
    var speakers = [];
    document.querySelectorAll("#speakers-list [data-speaker]").forEach(function (row) {
      var sf = function (f) { var e = $("[data-sf='" + f + "']", row); return e ? e.value.trim() : ""; };
      var name = sf("name");
      if (!name) return; // skip empty rows
      speakers.push({
        group: sf("group") || SPEAKER_GROUPS[0],
        name: name, role: sf("role"), org: sf("org"),
        photo: sf("photo"), topic: sf("topic"), bio: sf("bio")
      });
    });
    var payload = {
      banner: { enabled: el("c-banner-on").checked, text: el("c-banner-text").value.trim() },
      site: { theme: el("c-theme").value.trim(), dateText: el("c-dates").value.trim(), city: el("c-city").value.trim(), mapUrl: mapUrl },
      dates: dates, homeGallery: { heading: el("c-home-gallery-heading").value.trim(), photos: homeGalleryPhotos }, media: media, fees: fees, registrationPeriods: registrationPeriods,
      registrationPricing: {
        fixedItems: fixedItems
      },
      coupons: readCoupons(), pages: pages, committee: committee, speakers: speakers
    };
    api("/admin/api/content", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: payload })
    }).then(function (j) {
      if (j && j.ok) {
        contentData = j.content || payload;
        notifySiteContentChanged();
        toast("Content saved — live site updated");
      }
      else toast("Save failed", true);
    }).catch(function () { toast("Save failed", true); });
  }
  document.querySelectorAll("#save-content, [data-save-content]").forEach(function (button) {
    button.addEventListener("click", saveContent);
  });
  el("refresh-btn").addEventListener("click", loadAll);

  /* ---------- Boot ---------- */
  function showLogin() { el("login-view").style.display = "grid"; el("shell").style.display = "none"; }
  function showShell() {
    el("login-view").style.display = "none";
    el("shell").style.display = "block";
    if (window.matchMedia("(max-width: 900px)").matches) {
      $(".a-sidebar").classList.add("is-collapsed");
      $(".a-nav-toggle").setAttribute("aria-expanded", "false");
    }
    loadAll();
  }
  function setAdminUser(username) {
    var name = username || "Administrator";
    el("admin-user").textContent = name;
    el("admin-user").previousElementSibling.textContent = name.charAt(0).toUpperCase();
  }

  el("login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var username = el("user").value;
    var pw = el("pw").value;
    fetch("/api/csrf").then(function (csrfResponse) {
      return csrfResponse.json().then(function (csrf) {
        if (!csrfResponse.ok || !csrf.token) throw new Error("Could not initialize request security.");
        return fetch("/admin/login", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf.token },
          body: JSON.stringify({ username: username, password: pw })
        });
      });
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.ok) { csrfToken = j.csrf || ""; setAdminUser(username); el("pw").value = ""; el("login-msg").textContent = ""; showShell(); }
        else { el("login-msg").textContent = j.error || "Login failed."; }
      })
      .catch(function () { el("login-msg").textContent = "Could not reach the server."; });
  });

  el("logout-btn").addEventListener("click", function () {
    fetch("/admin/logout", { method: "POST", headers: { "X-CSRF-Token": csrfToken } })
      .then(function () { csrfToken = ""; showLogin(); });
  });
  fetch("/admin/api/session").then(function (r) { return r.json(); })
    .then(function (j) {
      csrfToken = j.csrf || "";
      if (j.authed) { setAdminUser(j.username); showShell(); }
      else showLogin();
    })
    .catch(showLogin);
})();
