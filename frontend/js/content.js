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
    banner: { enabled: false, text: "Abstract submissions for MatAi 2027 are now open. Register early to secure Early-Bird rates." },
    site: { theme: "Advancing Materials Innovation through Science, Engineering & Artificial Intelligence", dateText: "October 13–14, 2027", city: "Berlin, Germany" },
    homeGallery: { heading: "", photos: [] },
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
    committee: [
      { name: "Demo Committee Member 01", group: "Scientific Committee", role: "Demo Committee Member", org: "Demo University, Germany", bio: "Demo profile for preview only. Replace with the confirmed committee member's photo, affiliation, and biography before publication." },
      { name: "Demo Committee Member 02", group: "Scientific Committee", role: "Demo Committee Member", org: "Demo Institute of Technology, USA", bio: "Demo profile for preview only. Replace with the confirmed committee member's photo, affiliation, and biography before publication." },
      { name: "Demo Committee Member 03", group: "Scientific Committee", role: "Demo Committee Member", org: "Demo Research Centre, Belgium", bio: "Demo profile for preview only. Replace with the confirmed committee member's photo, affiliation, and biography before publication." },
      { name: "Demo Committee Member 04", group: "Scientific Committee", role: "Demo Committee Member", org: "Demo Technical University, China", bio: "Demo profile for preview only. Replace with the confirmed committee member's photo, affiliation, and biography before publication." },
      { name: "Demo Committee Member 05", group: "Scientific Committee", role: "Demo Committee Member", org: "Demo Materials Institute, Japan", bio: "Demo profile for preview only. Replace with the confirmed committee member's photo, affiliation, and biography before publication." },
      { name: "Demo Committee Member 06", group: "Scientific Committee", role: "Demo Committee Member", org: "Demo Science University, South Korea", bio: "Demo profile for preview only. Replace with the confirmed committee member's photo, affiliation, and biography before publication." },
      { name: "Demo Committee Member 07", group: "Scientific Committee", role: "Demo Committee Member", org: "Demo Polytechnic, India", bio: "Demo profile for preview only. Replace with the confirmed committee member's photo, affiliation, and biography before publication." },
      { name: "Demo Committee Member 08", group: "Scientific Committee", role: "Demo Committee Member", org: "Demo Engineering University, Canada", bio: "Demo profile for preview only. Replace with the confirmed committee member's photo, affiliation, and biography before publication." }
    ],
    speakers: [
      { name: "Demo Speaker 01", group: "Keynote Speakers", role: "Demo Keynote Speaker", org: "Institution to be confirmed", topic: "Advanced materials research", bio: "Demo profile for layout and scrolling review. Replace with the confirmed speaker biography before publication." },
      { name: "Demo Speaker 02", group: "Keynote Speakers", role: "Demo Keynote Speaker", org: "Institution to be confirmed", topic: "Artificial intelligence in materials science", bio: "Demo profile for layout and scrolling review. Replace with the confirmed speaker biography before publication." },
      { name: "Demo Speaker 03", group: "Plenary Speakers", role: "Demo Plenary Speaker", org: "Institution to be confirmed", topic: "Materials engineering and innovation", bio: "Demo profile for layout and scrolling review. Replace with the confirmed speaker biography before publication." },
      { name: "Demo Speaker 04", group: "Plenary Speakers", role: "Demo Plenary Speaker", org: "Institution to be confirmed", topic: "Computational materials science", bio: "Demo profile for layout and scrolling review. Replace with the confirmed speaker biography before publication." },
      { name: "Demo Speaker 05", group: "Featured / Invited Speakers", role: "Demo Invited Speaker", org: "Institution to be confirmed", topic: "Machine learning and materials informatics", bio: "Demo profile for layout and scrolling review. Replace with the confirmed speaker biography before publication." },
      { name: "Demo Speaker 06", group: "Featured / Invited Speakers", role: "Demo Invited Speaker", org: "Institution to be confirmed", topic: "Nanomaterials and nanotechnology", bio: "Demo profile for layout and scrolling review. Replace with the confirmed speaker biography before publication." },
      { name: "Demo Speaker 07", group: "Featured / Invited Speakers", role: "Demo Invited Speaker", org: "Institution to be confirmed", topic: "AI-driven materials discovery", bio: "Demo profile for layout and scrolling review. Replace with the confirmed speaker biography before publication." },
      { name: "Demo Speaker 08", group: "Featured / Invited Speakers", role: "Demo Invited Speaker", org: "Institution to be confirmed", topic: "Intelligent manufacturing", bio: "Demo profile for layout and scrolling review. Replace with the confirmed speaker biography before publication." }
    ]
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

  function parseGoogleMapsLocation(value) {
    try {
      var url = new URL(value, window.location.href);
      var host = url.hostname.toLowerCase();
      var mapsHost = /^maps\.google\.[a-z.]+$/.test(host) || host === "maps.app.goo.gl" ||
        (host === "goo.gl" && /^\/maps\//.test(url.pathname)) ||
        ((host === "google.com" || host === "www.google.com" || /^(?:www\.)?google\.[a-z.]+$/.test(host)) &&
          /^\/maps(?:\/|$)/.test(url.pathname));
      if (!/^https?:$/.test(url.protocol) || !mapsHost) return null;

      var destination = url.searchParams.get("q") || url.searchParams.get("query") ||
        url.searchParams.get("destination") || url.searchParams.get("ll") || "";
      var place = url.pathname.match(/\/place\/([^/?]+)/i);
      var coordinates = url.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
      if (!destination && place) destination = decodeURIComponent(place[1].replace(/\+/g, " "));
      if (!destination && coordinates) destination = coordinates[1] + "," + coordinates[2];
      var placeId = url.searchParams.get("query_place_id") || url.searchParams.get("destination_place_id") || "";
      var embedUrl = destination
        ? "https://www.google.com/maps?q=" + encodeURIComponent(destination) + "&output=embed"
        : url.href;
      var directionsUrl = url.href;
      if (destination) {
        directionsUrl = "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(destination);
        if (placeId) directionsUrl += "&destination_place_id=" + encodeURIComponent(placeId);
      }
      return { embedUrl: embedUrl, directionsUrl: directionsUrl, destination: destination };
    } catch (_) { return null; }
  }

  function updateVenueMap(content) {
    var frame = document.querySelector("#venue-map-frame iframe, main iframe[src*='google.com/maps'], main iframe[src*='maps.google.']");
    if (!frame) return;
    var site = content && content.site || {};
    var source = String(site.mapUrl || frame.getAttribute("src") || "").trim();
    var location = parseGoogleMapsLocation(source);
    if (!location) return;

    frame.src = location.embedUrl;
    if (location.destination) frame.title = "Google Map showing " + location.destination;
    var directions = document.getElementById("venue-directions-link");
    if (!directions) {
      directions = document.createElement("a");
      directions.id = "venue-directions-link";
      directions.className = "btn btn-primary mt-1";
      directions.target = "_blank";
      directions.rel = "noopener noreferrer";
      frame.parentNode.insertAdjacentElement("afterend", directions);
    }
    directions.href = location.directionsUrl;
    directions.textContent = location.destination ? "Get Directions to the Venue" : "Open Venue Location in Google Maps";
    directions.hidden = false;
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
    document.querySelectorAll("body > section.page-added-section, body > main > section.page-added-section").forEach(function (section) {
      section.remove();
    });
    if (pageOverrides) {
      var sections = Array.prototype.slice.call(document.querySelectorAll("body > section, body > main > section")).filter(function (section) {
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
        var main = document.querySelector("body > main");
        if (main) {
          main.appendChild(section);
        } else {
          var footer = document.querySelector("body > footer");
          document.body.insertBefore(section, footer || null);
        }
      });
    }

    applyLegacyHomeHeroLayout();
    renderHomeGallery(content.homeGallery || {});

    // The old Home hero gallery may remain in a saved page override.
    document.querySelectorAll(".hero-photo-rail").forEach(function (rail) {
      rail.remove();
    });

    // Committee members: [data-committee-group="<key>"] containers.
    // Speakers: [data-speaker-group="<key>"] containers.
    // Members/speakers entered in the admin panel render here as clickable
    // profile cards; empty groups fall back to a "will be added" message.
    var committeeData = Array.isArray(content.committee) && content.committee.length
      ? content.committee : DEFAULTS.committee;
    renderPeople("[data-committee-group]", "data-committee-group",
      committeeData,
      "Committee members will be added later.", "👤");
    var speakerData = Array.isArray(content.speakers) && content.speakers.length
      ? content.speakers : DEFAULTS.speakers;
    renderPeople("[data-speaker-group]", "data-speaker-group",
      speakerData,
      "Speaker names and profiles will be published in the final scientific program.", "🎤");
    renderPeople("[data-speaker-carousel]", "data-speaker-carousel",
      speakerData.concat(committeeData),
      "Speaker names and profiles will be published in the final scientific program.", "🎤");

    updateVenueMap(content);
    try { document.dispatchEvent(new CustomEvent("matai:content", { detail: content })); } catch (_) {}
  }

  function applyLegacyHomeHeroLayout() {
    if ((location.pathname.split("/").pop() || "index.html").toLowerCase() !== "index.html") return;
    var hero = document.querySelector(".home-page .home-hero");
    var legacyContent = hero && hero.querySelector(".hero-inner.center");
    if (!legacyContent) return;

    var theme = legacyContent.querySelector(".theme");
    if (theme && !legacyContent.querySelector(".home-topic-strip")) {
      var strip = document.createElement("div");
      strip.className = "home-topic-strip";
      strip.setAttribute("aria-label", "Conference research topics");

      var icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("class", "topic-icon");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("aria-hidden", "true");
      [
        ["circle", { cx: "12", cy: "12", r: "2" }],
        ["ellipse", { cx: "12", cy: "12", rx: "9", ry: "4.5" }],
        ["ellipse", { cx: "12", cy: "12", rx: "9", ry: "4.5", transform: "rotate(60 12 12)" }],
        ["ellipse", { cx: "12", cy: "12", rx: "9", ry: "4.5", transform: "rotate(120 12 12)" }]
      ].forEach(function (shape) {
        var element = document.createElementNS("http://www.w3.org/2000/svg", shape[0]);
        Object.keys(shape[1]).forEach(function (attribute) {
          element.setAttribute(attribute, shape[1][attribute]);
        });
        icon.appendChild(element);
      });
      strip.appendChild(icon);

      var lines = document.createElement("div");
      lines.className = "home-topic-lines";
      [
        ["Advanced Materials", "Smart Manufacturing", "AI & Machine Learning"],
        ["Sustainable Materials", "Nanotechnology", "Energy & Environment"]
      ].forEach(function (topics) {
        var line = document.createElement("div");
        line.className = "home-topic-line";
        topics.forEach(function (topic, index) {
          if (index) {
            var separator = document.createElement("i");
            separator.setAttribute("aria-hidden", "true");
            separator.textContent = "|";
            line.appendChild(separator);
          }
          var label = document.createElement("span");
          label.textContent = topic;
          line.appendChild(label);
        });
        lines.appendChild(line);
      });
      strip.appendChild(lines);
      theme.insertAdjacentElement("afterend", strip);
    }

    legacyContent.querySelectorAll(".hero-cta a[href='sessions.html']").forEach(function (button) {
      button.remove();
    });
  }

  function renderHomeGallery(gallery) {
    var photos = gallery && Array.isArray(gallery.photos) ? gallery.photos.filter(function (photo) {
      return typeof photo === "string" && /^(https?:\/\/|\/|\.\.?\/)/i.test(photo.trim());
    }) : [];
    var layout = document.querySelector("#home-dates .home-dates-layout");
    var section = document.getElementById("home-photo-gallery");
    if (!section && photos.length && layout) {
      section = document.createElement("section");
      section.className = "home-photo-gallery home-dates-photo-panel";
      section.id = "home-photo-gallery";
      section.setAttribute("aria-labelledby", "home-photo-gallery-heading");
      section.innerHTML = '<div class="center reveal"><h3 id="home-photo-gallery-heading"></h3></div><div class="home-gallery-shell mt-2"><button class="home-gallery-arrow prev" type="button" data-home-gallery-prev aria-label="Scroll photos left">‹</button><div class="home-gallery-track" data-home-gallery-track aria-label="Conference photos" tabindex="0"></div><button class="home-gallery-arrow next" type="button" data-home-gallery-next aria-label="Scroll photos right">›</button></div>';
      layout.appendChild(section);
    }
    if (!section) return;
    if (!photos.length) {
      section.hidden = true;
      if (layout) layout.classList.remove("has-gallery");
      return;
    }
    section.hidden = false;
    if (layout) layout.classList.add("has-gallery");
    var heading = document.getElementById("home-photo-gallery-heading");
    var headingText = String(gallery.heading || "").trim();
    var headingBlock = heading && heading.closest(".center");
    if (heading) heading.textContent = headingText;
    if (headingBlock) headingBlock.hidden = !headingText;
    if (headingText) {
      section.setAttribute("aria-labelledby", "home-photo-gallery-heading");
      section.removeAttribute("aria-label");
    } else {
      section.removeAttribute("aria-labelledby");
      section.setAttribute("aria-label", "Conference photos");
    }
    var track = section.querySelector("[data-home-gallery-track]");
    if (!track) return;
    track.innerHTML = photos.map(function (photo, i) {
      return '<figure class="home-gallery-slide"><img src="' + escapeHtml(photo.trim()) + '" alt="MatAi 2027 conference photo ' + (i + 1) + '" loading="lazy"></figure>';
    }).join("");
    section.querySelectorAll(".home-gallery-arrow").forEach(function (button) {
      button.hidden = photos.length < 2;
    });
    section.onclick = function (event) {
      var button = event.target.closest("[data-home-gallery-prev], [data-home-gallery-next]");
      if (!button) return;
      var firstSlide = track.querySelector(".home-gallery-slide");
      var step = firstSlide ? firstSlide.getBoundingClientRect().width + 20 : track.clientWidth * 0.85;
      track.scrollBy({ left: button.hasAttribute("data-home-gallery-next") ? step : -step, behavior: "smooth" });
    };
  }
  // Render a set of profile cards into every container matching `selector`,
  // filtered by the group value read from `attr`. Shows a placeholder note
  // when a group has no people. Cards reuse .person[data-profile] so the
  // shared profile modal (site.js) opens on click.
  function renderPeople(selector, attr, people, defaultEmpty, defaultAvatar) {
    document.querySelectorAll(selector).forEach(function (box) {
      var key = box.getAttribute(attr);
      var avatarEmoji = box.getAttribute("data-avatar") || defaultAvatar || "👤";
      var allGroups = attr === "data-speaker-carousel" || key === "all";
      var mine = people.filter(function (m) { return m && (allGroups || m.group === key); });
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
