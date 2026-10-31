/* ================================================================
   MatAi 2027 — registration form calculator (reference-format)
   Live pricing from a quantity-based fee table: participation
   (tiered), exhibition, sponsorship, special sponsorship, and
   add-ons. Builds the itemized Summary and keeps hidden fields
   (selectedItems, totalPrice, totalPriceEUR) in sync so the form
   submits cleanly through forms.js.
   ================================================================ */
(function () {
  "use strict";

  var form = document.querySelector('form[data-form="register"]');
  if (!form) return;

  // The active registration period and fees are managed in Admin.
  var ACTIVE = "eb";
  var PERIOD_TO_CODE = { "Early Bird": "eb", "Mid-Term": "mt", "On-Spot": "os" };
  var TAX_RATE = 0.05;
  var DISCOUNT_CODES = {};

  // Amounts are quoted and charged in the confirmed transaction currency; no browser conversion.
  var CUR = {
    USD: { code: "USD", sym: "$", rate: 1 },
    EUR: { code: "EUR", sym: "€", rate: null },
    GBP: { code: "GBP", sym: "£", rate: null },
    INR: { code: "INR", sym: "₹", rate: null }
  };
  var currencyRatesReady = false;
  var currencyRatesFailed = false;
  var currencyRateDate = "";
  var currencySelect = form.querySelector('select[name="preferredCurrency"]');
  var transactionCurrencyInput = id("transaction-currency");
  var originalCurrencyInput = id("original-selected-currency");
  var currencyFallbackInput = id("currency-fallback-confirmed");
  var currencyFallbackDialog = id("currency-fallback-dialog");
  var currencyFallbackMessage = id("currency-fallback-message");
  var currencySelectionNote = id("currency-selection-note");
  var rateDateInput = id("currency-rate-date");
  var usdToEurInput = id("usd-to-eur-rate");
  var pendingFallbackCurrency = "";

  function id(x) { return document.getElementById(x); }
  function num(el) { var v = parseInt(el && el.value, 10); return (isNaN(v) || v < 0) ? 0 : v; }
  function curInfo() {
    return CUR.USD;
  }
  function fmt(eur, ci) {
    ci = ci || curInfo();
    var v = Math.round((eur || 0) * ci.rate * 100) / 100;
    return new Intl.NumberFormat(ci.code === "INR" ? "en-IN" : "en-US", {
      style: "currency", currency: ci.code, minimumFractionDigits: 2, maximumFractionDigits: 2
    }).format(v);
  }

  function formatAmountOnly(amount, ci) {
    return new Intl.NumberFormat(ci && ci.code === "INR" ? "en-IN" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  }

  function fmtCents(cents, ci) {
    return new Intl.NumberFormat(ci.code === "INR" ? "en-IN" : "en-US", {
      style: "currency", currency: ci.code, minimumFractionDigits: 2, maximumFractionDigits: 2
    }).format((cents || 0) / 100);
  }

  function updateCurrencyNote() {
    if (!currencySelectionNote || !currencySelect) return;
    var selected = currencySelect.value;
    currencySelectionNote.textContent = selected === "USD"
      ? "USD is the configured checkout currency. The amount shown is the amount sent to the payment provider."
      : selected + " is not configured for this merchant. Confirm the USD checkout currency before payment.";
  }

  function loadCurrencyRates() {
    if (!currencySelectionNote) return;
    currencyRatesReady = true;
    currencyRatesFailed = false;
    resetCurrencyFallback();
    updateCurrencyNote();
  }

  function displayCurrencyAmount(amount, currency) {
    try {
      return new Intl.NumberFormat("en-US", {
      style: "currency",
        currency: currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount);
    } catch (_) {
      return currency + " " + Number(amount).toFixed(2);
    }
  }

  var rows = Array.prototype.slice.call(form.querySelectorAll("tr[data-item]"));
  var sumBody = id("sum-body");
  var sumTotal = id("sum-total");
  var totalInput = id("total-input");
  var totalDisplay = id("total-display");
  var totalEur = id("total-eur");
  var totalCur = id("total-cur");
  var selItems = id("selected-items");
  var participantCount = id("participant-count");
  var summaryRegistrationPrice = id("summary-registration-price");
  var summaryParticipants = id("summary-participants");
  var summaryAccommodation = id("summary-accommodation");
  var summaryNights = id("summary-nights");
  var summaryCheckIn = id("summary-check-in");
  var summaryCheckOut = id("summary-check-out");
  var summaryDiscount = id("summary-discount");
  var summarySubtotal = id("summary-subtotal");
  var summaryTax = id("summary-tax");
  var summaryTaxLabel = id("summary-tax-label");
  var couponCode = id("coupon-code");
  var couponApply = id("coupon-apply");
  var couponMsg = id("coupon-msg");
  var activeDiscount = 0;
  var activeFixedDiscount = 0;
  var activeCoupon = "";
  var humanVerification = form.querySelector("[data-human-verification]");
  var paymentGateway = id("payment-gateway");
  var paymentMethodHidden = id("payment-method-hidden");
  var registrationPeriodConfig = {
    active: "Early Bird",
    "Early Bird": { label: "Early Bird Registration", deadline: "To Be Announced" },
    "Mid-Term": { label: "Mid Term Registration", deadline: "To Be Announced" },
    "On-Spot": { label: "Late Registration", deadline: "To Be Announced" }
  };
  var lastRegistrationDate = new Date().toISOString().slice(0, 10);

  function resetCurrencyFallback() {
    if (transactionCurrencyInput) transactionCurrencyInput.value = "USD";
    if (originalCurrencyInput) originalCurrencyInput.value = currencySelect ? currencySelect.value : "USD";
    if (currencyFallbackInput) currencyFallbackInput.value = "false";
    if (rateDateInput) rateDateInput.value = currencyRateDate;
    if (usdToEurInput) usdToEurInput.value = currencyRatesReady && CUR.EUR.rate ? String(CUR.EUR.rate) : "";
  }

  function openCurrencyFallback(requestedCurrency) {
    pendingFallbackCurrency = requestedCurrency;
    var amount = totalEur ? Number(totalEur.value) : 0;
    if (currencyFallbackMessage) {
      currencyFallbackMessage.textContent = "This currency is unavailable for the configured payment providers. The payment will be processed in USD for " +
        displayCurrencyAmount(amount, "USD") + ". Continue?";
    }
    if (currencyFallbackDialog && typeof currencyFallbackDialog.showModal === "function") {
      currencyFallbackDialog.showModal();
    } else if (window.confirm(currencyFallbackMessage ? currencyFallbackMessage.textContent : "Continue in EUR?")) {
      confirmCurrencyFallback();
    } else {
      cancelCurrencyFallback();
    }
  }

  function handleCurrencySelection() {
    if (!currencySelect || currencySelect.value === "USD") {
      resetCurrencyFallback();
      updateCurrencyNote();
      renderRegistrationOptions();
      renderOptionalItems();
      recalc();
      return;
    }
    if (originalCurrencyInput) originalCurrencyInput.value = currencySelect.value;
    if (currencyFallbackInput) currencyFallbackInput.value = "false";
    updateCurrencyNote();
    renderRegistrationOptions();
    renderOptionalItems();
    recalc();
  }

  function confirmCurrencyFallback() {
    if (!pendingFallbackCurrency) return;
    if (originalCurrencyInput) originalCurrencyInput.value = pendingFallbackCurrency;
    if (transactionCurrencyInput) transactionCurrencyInput.value = "USD";
    if (currencyFallbackInput) currencyFallbackInput.value = "true";
    if (currencySelectionNote) {
      var amount = totalEur ? Number(totalEur.value) : 0;
      currencySelectionNote.textContent = "The confirmed checkout amount is " + displayCurrencyAmount(amount, "USD") + ".";
    }
    pendingFallbackCurrency = "";
    recalc();
  }

  function cancelCurrencyFallback() {
    pendingFallbackCurrency = "";
    if (currencySelect) currencySelect.value = "USD";
    resetCurrencyFallback();
    updateCurrencyNote();
    recalc();
  }

  if (currencySelect) {
    currencySelect.addEventListener("change", handleCurrencySelection);
  }
  if (currencyFallbackDialog) {
    currencyFallbackDialog.addEventListener("cancel", function (event) {
      event.preventDefault();
      currencyFallbackDialog.close("cancel");
      cancelCurrencyFallback();
    });
  }
  var fallbackConfirmButton = currencyFallbackDialog &&
    currencyFallbackDialog.querySelector("[data-currency-fallback-confirm]");
  var fallbackCancelButton = currencyFallbackDialog &&
    currencyFallbackDialog.querySelector("[data-currency-fallback-cancel]");
  if (fallbackConfirmButton) {
    fallbackConfirmButton.addEventListener("click", function () {
      if (currencyFallbackDialog.open) currencyFallbackDialog.close("confirm");
      confirmCurrencyFallback();
    });
  }
  if (fallbackCancelButton) {
    fallbackCancelButton.addEventListener("click", function () {
      if (currencyFallbackDialog.open) currencyFallbackDialog.close("cancel");
      cancelCurrencyFallback();
    });
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>\"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function quantityOptions(value) {
    var selected = Math.max(0, Math.min(100, parseInt(value, 10) || 0));
    var options = [];
    for (var i = 0; i <= 100; i++) {
      options.push('<option value="' + i + '"' + (i === selected ? ' selected' : '') + '>' + i + '</option>');
    }
    return options.join("");
  }

  function sourceQuantity(name) {
    for (var i = 0; i < rows.length; i++) {
      var input = rows[i].querySelector("input[data-qty]");
      if (input && input.name === name) return input;
    }
    return null;
  }

  function renderRegistrationOptions() {
    var target = id("registration-period-cards");
    if (!target) return;
    var periods = [
      { name: "Early Bird", code: "eb" },
      { name: "Mid-Term", code: "mt" },
      { name: "On-Spot", code: "os" }
    ];
    var categories = rows.filter(function (tr) { return !tr.hasAttribute("data-fixed"); });
    target.innerHTML = periods.map(function (period) {
      var config = registrationPeriodConfig[period.name] || {};
      var active = period.code === ACTIVE;
      var label = config.label || (period.name === "On-Spot" ? "Late Registration" : period.name + " Registration");
      if (period.name === "On-Spot" && label === "On-spot Registration") label = "Late Registration";
      var deadline = formatDeadline(config.deadline);
      var deadlinePassed = /^\d{4}-\d{2}-\d{2}$/.test(config.deadline || "") && config.deadline < new Date().toISOString().slice(0, 10);
      var choices = categories.map(function (tr) {
        var item = tr.getAttribute("data-item") || "Registration";
        var price = Number(tr.getAttribute("data-" + period.code)) || 0;
        var qty = tr.querySelector("input[data-qty]");
        var control = active && qty
          ? '<div class="registration-qty"><button type="button" data-quantity-change="-1" data-registration-category="' + escapeHtml(qty.name) + '" aria-label="Remove one ' + escapeHtml(item) + '">−</button><input type="number" min="0" max="100" inputmode="numeric" value="' + escapeHtml(qty.value) + '" data-registration-category-input="' + escapeHtml(qty.name) + '" aria-label="Quantity — ' + escapeHtml(item) + '"><button type="button" data-quantity-change="1" data-registration-category="' + escapeHtml(qty.name) + '" aria-label="Add one ' + escapeHtml(item) + '">+</button></div>'
          : '<span class="registration-qty-unavailable">' + (deadlinePassed ? "Period completed" : "Period not active") + "</span>";
        return '<div class="registration-choice"><div><strong>' + escapeHtml(item) + '</strong><span class="registration-choice-price">' + fmt(price) + '</span></div>' + control + '</div>';
      }).join("");
      return '<section class="registration-period-card' + (active ? ' active' : '') + '"><header><div><h4>' + escapeHtml(label) + '</h4><p>' + escapeHtml(deadline) + '</p></div>' + (active ? '<span class="period-active">Available</span>' : '') + '</header><div class="registration-choices">' + choices + '</div></section>';
    }).join("");
    target.querySelectorAll("[data-quantity-change]").forEach(function (button) {
      button.addEventListener("click", function () { var source = sourceQuantity(button.getAttribute("data-registration-category")); if (source) { source.value = String(Math.max(0, Math.min(100, num(source) + Number(button.getAttribute("data-quantity-change"))))); renderRegistrationOptions(); recalc(); } });
    });
    target.querySelectorAll("[data-registration-category-input]").forEach(function (input) {
      input.addEventListener("input", function () { var source = sourceQuantity(input.getAttribute("data-registration-category-input")); if (source) { source.value = String(Math.max(0, Math.min(100, parseInt(input.value, 10) || 0))); recalc(); } });
    });
  }

  function renderOptionalItems() {
    function fixedRow(key) {
      return rows.find(function (tr) { return tr.getAttribute("data-price-key") === key; });
    }
    function optionHtml(key, detail) {
      var tr = fixedRow(key);
      if (!tr) return "";
      var qty = tr.querySelector("input[data-qty]");
      var label = tr.getAttribute("data-item") || key;
      var price = Number(tr.getAttribute("data-price")) || 0;
      return '<div class="registration-addon-option"><div><strong>' + escapeHtml(label) + '</strong><span>' + escapeHtml(detail || "") + '</span></div><b>' + fmt(price) + '</b><label>Qty<select data-selection-for="' + escapeHtml(qty ? qty.name : "") + '" aria-label="Quantity for ' + escapeHtml(label) + '">' + quantityOptions(qty ? qty.value : "0") + '</select></label></div>';
    }
    var sponsors = id("sponsorship-options");
    if (sponsors) {
      sponsors.innerHTML = rows.filter(function (tr) {
        var key = tr.getAttribute("data-price-key") || "";
        return key.indexOf("exhibition_") === 0 || key.indexOf("sponsor_") === 0;
      }).map(function (tr) {
        var key = tr.getAttribute("data-price-key");
        return optionHtml(key, "");
      }).join("");
    }
    form.querySelectorAll("#registration-addon-list [data-selection-for], #sponsorship-options [data-selection-for]").forEach(function (visible) {
      visible.defaultValue = "0";
      var source = sourceQuantity(visible.getAttribute("data-selection-for"));
      if (source) visible.value = source.value;
    });
    var single = fixedRow("addon_accommodation_single");
    var double = fixedRow("addon_accommodation_double");
    var note = id("accommodation-rate-note");
    if (note && single && double) {
      note.textContent = "Single occupancy: " + fmt(Number(single.getAttribute("data-price")) || 0) + " per night · Double occupancy: " + fmt(Number(double.getAttribute("data-price")) || 0) + " per night.";
    }
  }

  function syncSelectionInputs() {
    form.querySelectorAll("[data-selection-for]").forEach(function (visible) {
      var source = sourceQuantity(visible.getAttribute("data-selection-for"));
      if (source) source.value = String(Math.max(0, Math.min(100, parseInt(visible.value, 10) || 0)));
    });
    var type = id("accommodation-type");
    var nights = id("accommodation-nights");
    var checkIn = id("check-in-date");
    var checkOut = id("check-out-date");
    var selected = type ? type.value : "";
    var hasAccommodation = selected === "single" || selected === "double";
    ["accommodation-nights-field", "accommodation-check-in-field", "accommodation-check-out-field"].forEach(function (fieldId) {
      var field = id(fieldId);
      if (field) field.hidden = !hasAccommodation;
    });
    if (!hasAccommodation) {
      if (nights) nights.value = "1";
      if (checkIn) checkIn.value = "";
      if (checkOut) checkOut.value = "";
    }
    var nightCount = Math.max(1, Math.min(5, parseInt(nights && nights.value, 10) || 1));
    if (hasAccommodation && checkIn && checkOut && checkIn.value) {
      var checkoutDate = new Date(checkIn.value + "T00:00:00Z");
      if (!isNaN(checkoutDate.getTime())) {
        checkoutDate.setUTCDate(checkoutDate.getUTCDate() + nightCount);
        checkOut.value = checkoutDate.toISOString().slice(0, 10);
      }
    } else if (checkOut) {
      checkOut.value = "";
    }
    var singleQty = sourceQuantity("qty_accom_single");
    var doubleQty = sourceQuantity("qty_accom_double");
    if (singleQty) singleQty.value = selected === "single" ? String(nightCount) : "0";
    if (doubleQty) doubleQty.value = selected === "double" ? String(nightCount) : "0";
  }

  function applyRegistrationPricing(pricing) {
    if (!pricing) return;
    var fixedItems = pricing.fixedItems || {};
    rows.forEach(function (tr) {
      var key = tr.getAttribute("data-price-key");
      if (!key || fixedItems[key] == null) return;
      var price = Number(fixedItems[key]);
      if (!isFinite(price) || price < 0) return;
      tr.setAttribute("data-price", String(price));
      var cell = tr.querySelector(".fp[data-base]");
      if (cell) cell.setAttribute("data-base", String(price));
    });
    renderOptionalItems();
    recalc();
  }
  function applyCoupons(coupons) {
    DISCOUNT_CODES = {};
    (Array.isArray(coupons) ? coupons : []).forEach(function (coupon) {
      if (!coupon || coupon.enabled === false || !coupon.code) return;
      if (coupon.validUntil && new Date(coupon.validUntil).getTime() < Date.now()) return;
      var percent = Number(coupon.discountPercentage != null ? coupon.discountPercentage : coupon.percent);
      if ((coupon.discountType || "percentage") === "percentage" && isFinite(percent) && percent > 0 && percent <= 100) {
        DISCOUNT_CODES[String(coupon.code).trim().toUpperCase()] = { percent: percent / 100, fixed: 0 };
      } else if (coupon.discountType === "fixed" && Number(coupon.fixedAmount) > 0) {
        DISCOUNT_CODES[String(coupon.code).trim().toUpperCase()] = { percent: 0, fixed: Math.round(Number(coupon.fixedAmount) * 100) };
      }
    });
    if (activeCoupon && !DISCOUNT_CODES[activeCoupon]) {
      activeCoupon = "";
      if (couponMsg) couponMsg.textContent = "Coupon not recognized. No discount applied.";
    }
    activeDiscount = (DISCOUNT_CODES[activeCoupon] || {}).percent || 0;
    activeFixedDiscount = (DISCOUNT_CODES[activeCoupon] || {}).fixed || 0;
    recalc();
  }

  function rowUnitPrice(tr) {
    if (tr.hasAttribute("data-fixed")) return parseFloat(tr.getAttribute("data-price")) || 0;
    return parseFloat(tr.getAttribute("data-" + ACTIVE)) || 0;
  }

  function formatDeadline(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return value || "To Be Announced";
    var parts = value.split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
      .toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }

  function effectiveRegistrationPeriod(periods) {
    var order = ["Early Bird", "Mid-Term", "On-Spot"];
    var index = order.indexOf(periods && periods.active);
    if (index < 0) index = 0;
    var today = new Date().toISOString().slice(0, 10);
    while (index < order.length - 1) {
      var config = periods && periods[order[index]];
      var deadline = config && config.deadline;
      // A tier remains active through its deadline date, then advances the next day.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline || "") || deadline >= today) break;
      index += 1;
    }
    return order[index];
  }

  /* ---- Optional admin-managed participation fees ---- */
  function applyFees(fees) {
    if (!fees) return;
    var map = { Speaker: "Speaker", Delegate: "Delegate", Poster: "Poster", Student: "Student", Virtual: "Virtual" };
    var periodKey = { eb: "Early Bird", mt: "Mid-Term", os: "On-Spot" };
    rows.forEach(function (tr) {
      if (tr.hasAttribute("data-fixed")) return;
      var item = tr.getAttribute("data-item") || "";
      var cat = null;
      for (var k in map) { if (item.indexOf(k) === 0) { cat = k; break; } }
      if (!cat) return;
      ["eb", "mt", "os"].forEach(function (t) {
        var v = fees[periodKey[t]] && fees[periodKey[t]][cat];
        if (v == null) return;
        tr.setAttribute("data-" + t, v);
        var cell = tr.querySelectorAll(".fp")[["eb", "mt", "os"].indexOf(t)];
        if (cell) cell.setAttribute("data-base", v);
      });
    });
    renderRegistrationOptions();
    recalc();
  }
  function applyRegistrationPeriods(periods) {
    if (!periods) return;
    registrationPeriodConfig = periods;
    var effectivePeriod = effectiveRegistrationPeriod(periods);
    ACTIVE = PERIOD_TO_CODE[effectivePeriod] || ACTIVE;
    var periodInput = id("registration-period");
    if (periodInput) periodInput.value = effectivePeriod;
    var order = ["Early Bird", "Mid-Term", "On-Spot"];
    form.querySelectorAll(".fee-table th.tier-h").forEach(function (th, i) {
      var p = order[i], row = periods[p] || {};
      var label = row.label || p;
      if (p === "On-Spot" && label === "On-spot Registration") label = "Late Registration";
      var deadline = formatDeadline(row.deadline);
      th.textContent = label;
      var note = document.createElement("small");
      note.textContent = deadline;
      th.appendChild(note);
      th.classList.toggle("eb", PERIOD_TO_CODE[p] === ACTIVE);
    });
    form.querySelectorAll(".fee-table td.fp").forEach(function (td) { td.classList.remove("eb"); });
    var activeIndex = ["eb", "mt", "os"].indexOf(ACTIVE);
    rows.forEach(function (tr) {
      if (tr.hasAttribute("data-fixed")) return;
      var cells = tr.querySelectorAll(".fp");
      if (cells[activeIndex]) cells[activeIndex].classList.add("eb");
    });
    renderRegistrationOptions();
    recalc();
  }
  if (window.MATAI_CONTENT) applyFees(window.MATAI_CONTENT.fees);
  if (window.MATAI_CONTENT) applyRegistrationPeriods(window.MATAI_CONTENT.registrationPeriods);
  if (window.MATAI_CONTENT) applyRegistrationPricing(window.MATAI_CONTENT.registrationPricing);
  if (window.MATAI_CONTENT) applyCoupons(window.MATAI_CONTENT.coupons);
  document.addEventListener("matai:content", function (e) {
    applyFees(e.detail && e.detail.fees);
    applyRegistrationPeriods(e.detail && e.detail.registrationPeriods);
    applyRegistrationPricing(e.detail && e.detail.registrationPricing);
    applyCoupons(e.detail && e.detail.coupons);
  });
  // Recheck date boundaries while the registration page remains open.
  window.setInterval(function () {
    var today = new Date().toISOString().slice(0, 10);
    var dateChanged = today !== lastRegistrationDate;
    if (dateChanged || effectiveRegistrationPeriod(registrationPeriodConfig) !== (id("registration-period") && id("registration-period").value)) {
      lastRegistrationDate = today;
      applyRegistrationPeriods(registrationPeriodConfig);
    }
  }, 60000);

  /* ---- Billing "same as above" ---- */
  var billingSame = id("billing-same");
  var billingGrid = id("billing-grid");
  function syncBilling() {
    if (!billingSame || !billingSame.checked) return;
    var g = function (n) { var el = form.querySelector('[name="' + n + '"]'); return el ? el.value : ""; };
    var s = function (n, v) { var el = form.querySelector('[name="' + n + '"]'); if (el) el.value = v; };
    s("billingName", g("fullName"));
    s("billingEmail", g("email"));
    s("billingCountry", g("country"));
    s("billingCity", g("city"));
  }
  if (billingSame) {
    billingSame.addEventListener("change", function () {
      if (billingGrid) billingGrid.classList.toggle("locked", billingSame.checked);
      syncBilling();
    });
  }

  function recalc() {
    syncSelectionInputs();
    var ci = curInfo();

    // Re-render every price cell in the selected currency.
    form.querySelectorAll(".fp[data-base]").forEach(function (cell) {
      var base = parseInt(cell.getAttribute("data-base"), 10);
      if (!isNaN(base)) cell.textContent = fmt(base, ci);
    });

    var grand = 0;
    var grandEUR = 0;
    var registrationTotal = 0;
    var accommodationTotal = 0;
    var participants = 0;
    var items = [];
    rows.forEach(function (tr) {
      var qtyEl = tr.querySelector("input[data-qty]");
      var qty = num(qtyEl);
      var unit = rowUnitPrice(tr);
      var unitUSDCents = Math.round(unit * 100);
      var unitDisplayCents = Math.round(unitUSDCents * ci.rate);
      var lineDisplayCents = unitDisplayCents * qty;
      var unitEURCents = currencyRatesReady ? Math.round(unitUSDCents * CUR.EUR.rate) : 0;
      grand += lineDisplayCents;
      grandEUR += unitEURCents * qty;
      if (!tr.hasAttribute("data-fixed")) {
        participants += qty;
        registrationTotal += lineDisplayCents;
      } else {
        var key = tr.getAttribute("data-price-key");
        if (key === "addon_accommodation_single" || key === "addon_accommodation_double") accommodationTotal += lineDisplayCents;
      }
      var rtot = tr.querySelector("[data-line]");
      if (rtot) rtot.textContent = fmtCents(lineDisplayCents, ci);
      tr.classList.toggle("chosen", qty > 0);
      if (qty > 0) items.push({ name: tr.getAttribute("data-item"), qty: qty, unit: unitDisplayCents, line: lineDisplayCents });
    });

    var discount = Math.min(grand, activeFixedDiscount || Math.round(grand * activeDiscount));
    var subtotal = Math.max(0, grand - discount);
    var tax = Math.round(subtotal * TAX_RATE);
    var finalTotal = subtotal + tax;
    var discountEUR = Math.round(grandEUR * activeDiscount);
    var subtotalEUR = Math.max(0, grandEUR - discountEUR);
    var taxEUR = Math.round(subtotalEUR * TAX_RATE);
    var finalTotalEUR = subtotalEUR + taxEUR;

    // Build the summary table.
    if (sumBody) {
      if (!items.length) {
        sumBody.innerHTML = '<tr class="sum-empty"><td colspan="4">No items selected yet — set a quantity above.</td></tr>';
      } else {
        sumBody.innerHTML = items.map(function (it) {
          var name = String(it.name || "").replace(/[&<>"]/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
          });
          return '<tr><td>' + name + '</td><td class="c">' + it.qty +
                 '</td><td class="r">' + fmtCents(it.unit, ci) + '</td><td class="r">' + fmtCents(it.line, ci) + '</td></tr>';
        }).join("");
      }
    }

    if (sumTotal) sumTotal.textContent = fmtCents(finalTotal, ci);
    if (totalCur) totalCur.textContent = ci.sym;
    if (totalInput) totalInput.value = (finalTotal / 100).toFixed(2);
    if (totalDisplay) totalDisplay.value = formatAmountOnly(finalTotal / 100, ci);
    if (totalEur) totalEur.value = (finalTotalEUR / 100).toFixed(2);
    if (paymentGateway && paymentMethodHidden) paymentMethodHidden.value = paymentGateway.value;
    if (participantCount) participantCount.value = participants;
    if (summaryRegistrationPrice) summaryRegistrationPrice.textContent = fmtCents(registrationTotal, ci);
    if (summaryParticipants) summaryParticipants.textContent = participants;
    if (summaryAccommodation) summaryAccommodation.textContent = fmtCents(accommodationTotal, ci);
    var bookedNights = (sourceQuantity("qty_accom_single") && num(sourceQuantity("qty_accom_single"))) ||
      (sourceQuantity("qty_accom_double") && num(sourceQuantity("qty_accom_double"))) || 0;
    if (summaryNights) summaryNights.textContent = bookedNights ? String(bookedNights) : "—";
    if (summaryCheckIn) summaryCheckIn.textContent = id("check-in-date") && id("check-in-date").value || "—";
    if (summaryCheckOut) summaryCheckOut.textContent = id("check-out-date") && id("check-out-date").value || "—";
    if (summaryDiscount) summaryDiscount.textContent = "-" + fmtCents(discount, ci);
    if (summarySubtotal) summarySubtotal.textContent = fmtCents(subtotal, ci);
    if (summaryTax) summaryTax.textContent = fmtCents(tax, ci);
    if (summaryTaxLabel) {
      var taxPercent = (TAX_RATE * 100).toFixed(2).replace(/\.?0+$/, "");
      summaryTaxLabel.textContent = "Tax (" + taxPercent + "%):";
    }

    // Keep the selected-item list in the submitted record.
    if (selItems) {
      selItems.value = items.length
        ? items.map(function (it) { return it.name + " ×" + it.qty; }).join("; ")
        : "";
    }

    syncBilling();
  }

  // Recalculate on any change, and keep quantities non-negative integers.
  form.addEventListener("input", recalc);
  form.addEventListener("change", recalc);
  if (couponApply) {
    couponApply.addEventListener("click", function () {
      var code = (couponCode && couponCode.value ? couponCode.value : "").trim().toUpperCase();
      activeCoupon = code;
      activeDiscount = (DISCOUNT_CODES[code] || {}).percent || 0;
      activeFixedDiscount = (DISCOUNT_CODES[code] || {}).fixed || 0;
      if (couponMsg) {
        couponMsg.textContent = (activeDiscount || activeFixedDiscount)
          ? "Coupon applied: " + (activeFixedDiscount ? fmtCents(activeFixedDiscount, CUR.USD) : Math.round(activeDiscount * 100) + "%") + " discount."
          : (code ? "Coupon not recognized. No discount applied." : "Enter a conference coupon code if one has been provided.");
      }
      recalc();
    });
  }

  form.addEventListener("submit", function (e) {
    if (!humanVerification || !window.MATAIHumanVerification || !window.MATAIHumanVerification.isVerified(form)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (humanVerification) {
        humanVerification.classList.add("invalid");
        humanVerification.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }
    if (!selItems || !selItems.value.trim()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      var emptyStatus = form.querySelector(".form-status");
      if (emptyStatus) {
        emptyStatus.className = "form-status err";
        emptyStatus.textContent = "Select at least one registration category or optional item.";
      }
      return;
    }
    if (currencySelect && currencySelect.value !== "USD" && currencyFallbackInput && currencyFallbackInput.value !== "true") {
      e.preventDefault();
      e.stopImmediatePropagation();
      openCurrencyFallback(currencySelect.value);
      return;
    }
    if (paymentGateway && paymentGateway.value === "Stripe / Card Payment") {
      e.preventDefault();
      e.stopImmediatePropagation();
      var status = form.querySelector(".form-status");
      var submitButton = form.querySelector('[type="submit"]');
      if (window.MATAI_STRIPE_ENABLED === false) {
        if (status) {
          status.className = "form-status err";
          status.textContent = "Stripe checkout is not configured. Please select another available payment method or contact the organizers.";
        }
        return;
      }
      var payload = {};
      new FormData(form).forEach(function (value, key) { payload[key] = value; });
      form.querySelectorAll('input[type="checkbox"][name]').forEach(function (checkbox) {
        payload[checkbox.name] = checkbox.checked;
      });
      var oldText = submitButton ? submitButton.textContent : "";
      if (submitButton) { submitButton.disabled = true; submitButton.textContent = "Starting secure checkout…"; }
      fetch("/api/csrf").then(function (csrfResponse) {
        return csrfResponse.json().then(function (csrf) {
          if (!csrfResponse.ok || !csrf.token) throw new Error("Could not initialize request security.");
          return fetch("/api/checkout/stripe", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf.token },
            body: JSON.stringify(payload)
          });
        });
      }).then(function (response) {
        return response.json().then(function (result) {
          if (!response.ok) throw new Error(result.error || "Could not start checkout.");
          return result;
        });
      }).then(function (result) {
        if (result.currency !== payload.currency ||
            Math.round(Number(result.amount) * 100) !== Math.round(Number(payload.totalPrice) * 100)) {
          throw new Error("The confirmed checkout amount or currency did not match your registration summary.");
        }
        var checkoutUrl = new URL(result.url, location.href);
        if (checkoutUrl.origin !== "https://checkout.stripe.com") throw new Error("Stripe returned an invalid checkout URL.");
        location.assign(checkoutUrl.href);
      }).catch(function (error) {
        if (status) {
          status.className = "form-status err";
          status.textContent = error.message || "Could not start Stripe checkout. Please try again.";
        }
        if (submitButton) { submitButton.disabled = false; submitButton.textContent = oldText; }
      });
    }
  }, true);
  form.addEventListener("reset", function () {
    setTimeout(function () {
      if (billingGrid) billingGrid.classList.remove("locked");
      activeDiscount = 0;
      activeFixedDiscount = 0;
      activeCoupon = "";
      pendingFallbackCurrency = "";
      resetCurrencyFallback();
      updateCurrencyNote();
      syncPaymentChoice();
      if (couponMsg) couponMsg.textContent = "Enter a conference coupon code if one has been provided.";
      recalc();
    }, 0);
  });

  function syncPaymentChoice() {
    var choices = form.querySelectorAll('input[name="paymentGatewayChoice"]');
    choices.forEach(function (choice) {
      var card = choice.closest(".payment-method-card");
      if (card) card.classList.toggle("selected", choice.checked);
      if (choice.checked && paymentGateway) paymentGateway.value = choice.value;
    });
    if (paymentGateway && paymentMethodHidden) paymentMethodHidden.value = paymentGateway.value;
  }
  form.querySelectorAll('input[name="paymentGatewayChoice"]').forEach(function (choice) {
    choice.addEventListener("change", function () {
      syncPaymentChoice();
      recalc();
    });
  });
  syncPaymentChoice();

  renderRegistrationOptions();
  renderOptionalItems();
  var params = new URLSearchParams(location.search);
  var couponPrefill = (params.get("coupon") || "").trim().toUpperCase();
  if (couponPrefill && couponCode) {
    couponCode.value = couponPrefill;
    activeCoupon = couponPrefill;
    activeDiscount = (DISCOUNT_CODES[activeCoupon] || {}).percent || 0;
    activeFixedDiscount = (DISCOUNT_CODES[activeCoupon] || {}).fixed || 0;
    if (couponMsg) couponMsg.textContent = (activeDiscount || activeFixedDiscount) ? "Coupon applied. It will be revalidated by the server before payment." : "Coupon will be validated by the server before payment.";
  }
  var categoryPrefill = (params.get("cat") || params.get("pkg") || "").toLowerCase();
  if (categoryPrefill) {
    var preferred = rows.find(function (tr) {
      return !tr.hasAttribute("data-fixed") && (tr.getAttribute("data-item") || "").toLowerCase().indexOf(categoryPrefill) !== -1;
    });
    var preferredQty = preferred && preferred.querySelector("input[data-qty]");
    if (preferredQty) {
      preferredQty.value = "1";
      renderRegistrationOptions();
    }
  }
  recalc();
  loadCurrencyRates();
})();
