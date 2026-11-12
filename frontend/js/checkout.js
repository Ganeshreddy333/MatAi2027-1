(function () {
  "use strict";

  var form = document.querySelector('form[data-form="register"]');
  if (!form) return;

  var status = form.querySelector(".form-status");
  var paymentSelect = form.querySelector('[name="paymentGateway"]');
  var payNote = document.querySelector(".pay-note");
  var params = new URLSearchParams(location.search);
  var configs = { stripe: false, paypal: false, razorpay: false };
  var razorpayScriptPromise;
  var verificationPanel = document.getElementById("payment-verification");
  var verificationTitle = document.getElementById("payment-verification-title");
  var verificationMessage = document.getElementById("payment-verification-message");
  var receiptButton = document.getElementById("download-receipt");
  var retryButton = document.getElementById("retry-registration");
  var verificationTimer = null;
  var verificationAttempts = 0;
  var RECEIPT_SESSION_KEY = "matai-razorpay-verification";

  function option(value) {
    var choices = form.querySelectorAll('input[name="paymentGatewayChoice"]');
    var choice = Array.prototype.find.call(choices, function (item) {
      return item.value === value;
    });
    if (choice) return choice;
    if (!paymentSelect || !paymentSelect.options) return null;
    return Array.prototype.find.call(paymentSelect.options, function (item) {
      return item.value === value;
    });
  }

  function selectAvailableGateway() {
    var choices = form.querySelectorAll('input[name="paymentGatewayChoice"]');
    var fallback = Array.prototype.find.call(choices, function (choice) {
      var card = choice.closest(".payment-method-card");
      return !choice.disabled && !(card && card.hidden);
    });
    if (fallback) {
      fallback.checked = true;
      fallback.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function showStatus(kind, text) {
    if (!status) return;
    status.className = "form-status " + kind;
    status.textContent = text;
    status.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function request(url, body, accessToken) {
    return fetch("/api/csrf").then(function (response) {
      return response.json().then(function (csrf) {
        if (!response.ok || !csrf.token) throw new Error("Could not initialize request security.");
        return fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf.token,
            ...(accessToken ? { "X-Registration-Access": accessToken } : {})
          },
          body: JSON.stringify(body)
        });
      });
    }).then(function (response) {
      return response.json().then(function (result) {
        if (!response.ok) throw new Error(result.error || "Payment request failed.");
        return result;
      });
    });
  }

  function formData() {
    var data = {};
    new FormData(form).forEach(function (value, key) { data[key] = value; });
    form.querySelectorAll('input[type="checkbox"][name]').forEach(function (checkbox) {
      data[checkbox.name] = checkbox.checked;
    });
    return data;
  }

  function checkoutMatchesQuote(order, quote, minorUnits) {
    if (!order || !quote || order.currency !== quote.currency) return false;
    var quotedAmount = Number(quote.totalMinor);
    var orderAmount = Number(order.amount);
    if (!Number.isSafeInteger(quotedAmount) || !Number.isFinite(orderAmount)) return false;
    var returnedCents = minorUnits ? Math.round(orderAmount) : Math.round(orderAmount * 100);
    return returnedCents === quotedAmount;
  }

  function verifyServerQuote(data) {
    return request("/api/checkout/quote", data).then(function (quote) {
      var quotedCents = Number(quote.totalMinor);
      var submittedCents = Math.round(Number(data.totalPrice) * 100);
      if (!Number.isSafeInteger(quotedCents) || !Number.isSafeInteger(submittedCents) ||
          quote.currency !== data.currency || !Array.isArray(quote.items) ||
          !Number.isSafeInteger(Number(quote.subtotalMinor)) ||
          !Number.isSafeInteger(Number(quote.discountMinor)) ||
          !Number.isSafeInteger(Number(quote.taxMinor))) {
        throw new Error("The server returned an invalid checkout quote. No payment was started.");
      }
      if (window.MATAI_SERVER_QUOTE) window.MATAI_SERVER_QUOTE.apply(quote);
      if (quotedCents !== submittedCents &&
          (!window.MATAI_SERVER_QUOTE || !window.MATAI_SERVER_QUOTE.confirm(quote, submittedCents))) {
        throw new Error("Checkout was cancelled because the server-calculated amount differs from the previously displayed total.");
      }
      return quote;
    });
  }

  function paymentMessage(result, prefix) {
    var amount = Number(result.amount);
    var displayAmount = "";
    if (Number.isFinite(amount) && result.currency) {
      try {
        displayAmount = new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: result.currency
        }).format(amount);
      } catch (_) {
        displayAmount = result.currency + " " + amount.toFixed(2);
      }
    }
    return prefix + (displayAmount ? " Transaction: " + displayAmount + "." : "") +
      " Registration reference: " + result.reference + ".";
  }

  function setProviderAvailability(provider, enabled) {
    var label = {
      stripe: "Stripe / Card Payment",
      paypal: "PayPal",
      razorpay: "Razorpay"
    }[provider];
    var item = option(label);
    if (!item) return;
    if (item.type === "radio") {
      var card = item.closest(".payment-method-card");
      item.disabled = !enabled;
      if (card) {
        card.classList.toggle("is-unavailable", !enabled);
        if (provider === "stripe") card.hidden = !enabled;
      }
      if (!enabled && item.checked) selectAvailableGateway();
      return;
    }
    item.disabled = !enabled;
    item.textContent = enabled ? label : label + " (not configured)";
    if (!enabled && paymentSelect.value === label) {
      var fallback = option("Bank Transfer");
      if (fallback && fallback.type === "radio") {
        fallback.checked = true;
        fallback.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        paymentSelect.value = "Bank Transfer";
        paymentSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }

  function loadRazorpayScript() {
    if (window.Razorpay) return Promise.resolve();
    if (!razorpayScriptPromise) {
      razorpayScriptPromise = new Promise(function (resolve, reject) {
        var script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.onload = resolve;
        script.onerror = function () { reject(new Error("Could not load Razorpay checkout.")); };
        document.head.appendChild(script);
      });
    }
    return razorpayScriptPromise;
  }

  function showVerification(title, message, kind) {
    if (!verificationPanel) return;
    var shouldScroll = verificationPanel.hidden || verificationTitle.textContent !== title;
    verificationPanel.hidden = false;
    verificationPanel.className = "payment-verification form-status " + (kind || "info");
    verificationTitle.textContent = title;
    verificationMessage.textContent = message;
    receiptButton.hidden = true;
    retryButton.hidden = true;
    if (shouldScroll) verificationPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function readVerification() {
    try {
      var value = sessionStorage.getItem(RECEIPT_SESSION_KEY);
      return value ? JSON.parse(value) : null;
    } catch (_) {
      return null;
    }
  }

  function saveVerification(context) {
    try {
      sessionStorage.setItem(RECEIPT_SESSION_KEY, JSON.stringify(context));
      history.replaceState(null, "", "?payment=razorpay&registration=" + encodeURIComponent(context.reference));
      return true;
    } catch (_) {
      showVerification(
        "Payment verification is in progress.",
        "Keep this page open while the server confirms the transaction. Do not make another payment until the existing transaction is checked.",
        "info"
      );
      return false;
    }
  }

  function downloadVerifiedReceipt(context) {
    fetch("/api/registrations/" + encodeURIComponent(context.reference) + "/receipt", {
      headers: { "X-Registration-Access": context.accessToken },
      credentials: "same-origin"
    }).then(function (response) {
      if (!response.ok) return response.json().then(function (result) {
        throw new Error(result.error || "The verified receipt is not available yet.");
      });
      return response.blob();
    }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = "MatAI-2027-Receipt-" + context.reference + ".pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }).catch(function (error) {
      showVerification("Receipt download unavailable.", error.message, "err");
    });
  }

  function displayVerificationStatus(context, result) {
    if (result.receiptReady === true && result.paid === true) {
      if (verificationTimer) window.clearTimeout(verificationTimer);
      showVerification(
        "✓ Payment Successful!",
        "Your MatAI 2027 registration is confirmed. Receipt number: " + result.receiptNumber + ".",
        "ok"
      );
      receiptButton.hidden = false;
      receiptButton.onclick = function () { downloadVerifiedReceipt(context); };
      return true;
    }
    if (result.verificationStatus === "FAILED") {
      var submit = form.querySelector('[type="submit"]');
      if (submit) { submit.disabled = false; submit.textContent = "Continue to payment"; }
      showVerification("Payment Failed.", "Razorpay reported that this payment failed. You may return to registration and try again.", "err");
      retryButton.hidden = false;
      retryButton.onclick = function () {
        if (verificationTimer) window.clearTimeout(verificationTimer);
        try { sessionStorage.removeItem(RECEIPT_SESSION_KEY); } catch (_) {}
        history.replaceState(null, "", location.pathname);
        verificationPanel.hidden = true;
        form.scrollIntoView({ behavior: "smooth", block: "start" });
      };
      return false;
    }
    var pending = ["INITIATED", "WEBHOOK_VERIFIED", "CALLBACK_VERIFIED", "CHECKOUT_COMPLETED",
      "RAZORPAY_PAYMENT_VERIFIED", "FINANCIAL_RECONCILED", "DATABASE_VALIDATED", "FULLY_VERIFIED"].indexOf(
      result.verificationStatus
    ) > -1;
    showVerification(
      pending ? "Payment confirmation is pending." : "Your payment is being verified.",
      "We are checking your payment with Razorpay and matching it to your registration. Please do not make another payment until the existing transaction is checked.",
      "info"
    );
    return false;
  }

  function startPaymentVerification(context) {
    if (!context || !context.reference || !context.accessToken) return;
    if (verificationTimer) window.clearTimeout(verificationTimer);
    verificationAttempts = 0;
    var lastVerificationStatus = "";
    var submit = form.querySelector('[type="submit"]');
    if (submit) { submit.disabled = true; submit.textContent = "Checking payment..."; }
    showVerification(
      "Verifying your payment and registration...",
      "Please wait while we confirm payment with Razorpay and our registration records.",
      "info"
    );
    function check() {
      verificationAttempts += 1;
      fetch("/api/registrations/" + encodeURIComponent(context.reference) + "/payment-status", {
        headers: { "X-Registration-Access": context.accessToken },
        credentials: "same-origin"
      }).then(function (response) {
        return response.json().then(function (result) {
          if (!response.ok) throw new Error(result.error || "Payment status could not be verified.");
          return result;
        });
      }).then(function (result) {
        lastVerificationStatus = result.verificationStatus || "";
        if (displayVerificationStatus(context, result)) return true;
        if (context.payment && result.verificationStatus !== "FAILED") {
          return request("/api/checkout/razorpay/verify", context.payment, context.accessToken)
            .then(function (verifyResult) {
              lastVerificationStatus = verifyResult.verificationStatus || "";
              if (displayVerificationStatus(context, verifyResult)) return true;
            })
            .catch(function () {
              return false;
            });
        }
      }).then(function (finished) {
        if (finished === true) return;
        if (verificationAttempts >= 60) {
          if (lastVerificationStatus === "FAILED") {
            displayVerificationStatus(context, { verificationStatus: "FAILED" });
            return;
          }
          showVerification(
            "Payment confirmation is pending.",
            "This transaction is still being checked. Do not make another payment; contact the organizers if this message remains.",
            "info"
          );
          return;
        }
        verificationTimer = window.setTimeout(check, 3000);
      }).catch(function (error) {
        showVerification(
          "Payment confirmation is pending.",
          (error.message || "We could not retrieve the latest status.") +
            " Do not make another payment until the existing transaction is checked.",
          "info"
        );
        if (verificationAttempts < 60) verificationTimer = window.setTimeout(check, 5000);
      });
    }
    check();
  }

  function startRazorpay(data, button, oldText) {
    verifyServerQuote(data).then(function (quote) {
      return request("/api/checkout/razorpay/order", data).then(function (order) {
        return { quote: quote, order: order };
      });
    }).then(function (result) {
      var quote = result.quote;
      var order = result.order;
      if (!checkoutMatchesQuote(order, quote, true)) {
        throw new Error("Razorpay order amount or currency did not match the authoritative server quote.");
      }
      var context = {
        reference: order.reference,
        orderId: order.orderId,
        accessToken: order.receiptAccessToken,
        payment: null
      };
      if (!saveVerification(context)) {
        throw new Error("Secure payment recovery could not be saved in this browser session. No checkout was opened.");
      }
      return loadRazorpayScript().then(function () {
        var checkout = new window.Razorpay({
          key: order.keyId,
          order_id: order.orderId,
          amount: order.amount,
          currency: order.currency,
          name: "MatAi 2027",
          description: "Conference registration",
          prefill: { name: data.fullName, email: data.email },
          notes: { reference: order.reference },
          theme: { color: "#1f4d3a" },
          handler: function (payment) {
            context.payment = payment;
            saveVerification(context);
            startPaymentVerification(context);
          },
          modal: {
            ondismiss: function () {
              showVerification(
                "Payment confirmation is pending.",
                "Checkout was closed. A payment may still be processing; do not make another payment until the existing transaction is checked.",
                "info"
              );
              startPaymentVerification(context);
              if (button) { button.disabled = false; button.textContent = oldText; }
            }
          }
        });
        checkout.on("payment.failed", function (response) {
          showVerification(
            "Payment confirmation is pending.",
            (response.error && response.error.description || "Razorpay could not complete the payment.") +
              " We are checking the final transaction status. Do not make another payment until it is confirmed.",
            "info"
          );
          startPaymentVerification(context);
          if (button) { button.disabled = false; button.textContent = oldText; }
        });
        checkout.open();
      });
    }).catch(function (error) {
      showStatus("err", error.message || "Could not start Razorpay checkout.");
      if (button) { button.disabled = false; button.textContent = oldText; }
    });
  }

  function handleCheckout(event) {
    var gateway = paymentSelect && paymentSelect.value;
    if (gateway !== "PayPal" && gateway !== "Razorpay") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!configs[gateway.toLowerCase()]) {
      showStatus("err", gateway + " checkout is not configured. Choose another payment method.");
      return;
    }
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    var button = form.querySelector('[type="submit"]');
    var oldText = button ? button.textContent : "";
    if (button) { button.disabled = true; button.textContent = "Starting secure checkout…"; }
    var data = formData();
    if (gateway === "PayPal") {
      verifyServerQuote(data).then(function (quote) {
        return request("/api/checkout/paypal/order", data).then(function (order) {
          return { quote: quote, order: order };
        });
      }).then(function (result) {
        var quote = result.quote;
        var order = result.order;
        if (!checkoutMatchesQuote(order, quote, false)) {
          throw new Error("PayPal order amount or currency did not match the authoritative server quote.");
        }
        var approvalUrl = new URL(order.approvalUrl);
        if (approvalUrl.protocol !== "https:" || !/(^|\.)paypal\.com$/i.test(approvalUrl.hostname)) {
          throw new Error("PayPal returned an invalid approval URL.");
        }
        location.assign(approvalUrl.href);
      }).catch(function (error) {
        showStatus("err", error.message || "Could not start PayPal checkout.");
        if (button) { button.disabled = false; button.textContent = oldText; }
      });
      return;
    }
    startRazorpay(data, button, oldText);
  }

  form.addEventListener("submit", handleCheckout, true);

  form.addEventListener("reset", function () {
    window.setTimeout(function () {
      ["stripe", "paypal", "razorpay"].forEach(function (provider) {
        setProviderAvailability(provider, configs[provider]);
      });
      if (!configs.stripe && !configs.paypal && !configs.razorpay && paymentSelect) {
        paymentSelect.value = "Bank Transfer";
        paymentSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, 0);
  });

  fetch("/api/checkout/config").then(function (response) {
    if (!response.ok) throw new Error("Could not load checkout configuration.");
    return response.json();
  }).then(function (result) {
    configs.stripe = Boolean(result.stripe && result.stripe.enabled);
    configs.paypal = Boolean(result.paypal && result.paypal.enabled);
    configs.razorpay = Boolean(result.razorpay && result.razorpay.enabled);
    window.MATAI_STRIPE_ENABLED = configs.stripe;
    ["stripe", "paypal", "razorpay"].forEach(function (provider) {
      setProviderAvailability(provider, configs[provider]);
    });
    var active = [];
    if (configs.stripe) active.push("Stripe");
    if (configs.paypal) active.push("PayPal");
    if (configs.razorpay) active.push("Razorpay (" + result.razorpay.currency + ")");
    if (payNote) payNote.textContent = active.length
      ? active.join(", ") + " checkout is available. Online payments are verified by the provider before being marked paid."
      : "Online checkout is not configured. Choose Bank Transfer for organizer follow-up.";
  }).catch(function () {
    window.MATAI_STRIPE_ENABLED = false;
    configs = { stripe: false, paypal: false, razorpay: false };
    ["stripe", "paypal", "razorpay"].forEach(function (provider) {
      setProviderAvailability(provider, false);
    });
    if (payNote) payNote.textContent = "Could not load online payment settings. Choose Bank Transfer for organizer follow-up.";
  });

  if (params.get("checkout") === "cancelled" || params.get("checkout") === "paypal-cancelled") {
    showStatus("err", "Checkout was cancelled. No payment was confirmed; you may try again.");
  } else if (params.get("checkout") === "success") {
    var sessionId = params.get("session_id") || "";
    if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
      showStatus("err", "We could not verify this checkout session. Please contact the organizers before paying again.");
      return;
    }
    showStatus("info", "Verifying your payment with Stripe…");
    fetch("/api/checkout/stripe/status/" + encodeURIComponent(sessionId)).then(function (response) {
      return response.json().then(function (result) {
        if (!response.ok) throw new Error(result.error || "Payment status is not available yet.");
        return result;
      });
    }).then(function (result) {
      if (result.paid) showStatus("ok", paymentMessage(result, "Payment received."));
      else showStatus("info", paymentMessage(result, "Your payment is being confirmed."));
    }).catch(function (error) {
      showStatus("err", error.message || "We could not verify payment status. Please contact the organizers.");
    });
  } else if (params.get("checkout") === "paypal-return") {
    var paypalOrderId = params.get("token") || "";
    if (!/^[A-Za-z0-9-]+$/.test(paypalOrderId)) {
      showStatus("err", "We could not verify the PayPal order. Please contact the organizers.");
      return;
    }
    showStatus("info", "Confirming your PayPal payment…");
    request("/api/checkout/paypal/capture", { orderId: paypalOrderId }).then(function (result) {
      if (result.paid) {
        showStatus("ok", paymentMessage(result, "Payment received."));
      } else {
        showStatus("info", paymentMessage(result, result.error || "PayPal payment is still pending."));
      }
    }).catch(function (error) {
      showStatus("err", error.message || "We could not confirm PayPal payment. Contact the organizers if you were charged.");
    });
  } else if (params.get("payment") === "razorpay") {
    var savedVerification = readVerification();
    if (savedVerification && savedVerification.reference === params.get("registration")) {
      startPaymentVerification(savedVerification);
    } else {
      showStatus("err", "Payment verification access is unavailable in this browser session. Contact the organizers before attempting another payment.");
    }
  }
})();
