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

  function request(url, body) {
    return fetch("/api/csrf").then(function (response) {
      return response.json().then(function (csrf) {
        if (!response.ok || !csrf.token) throw new Error("Could not initialize request security.");
        return fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf.token },
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

  function startRazorpay(data, button, oldText) {
    request("/api/checkout/razorpay/order", data).then(function (order) {
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
            request("/api/checkout/razorpay/verify", payment).then(function (result) {
              if (result.paid) {
                form.reset();
                showStatus("ok", "Payment received. Your registration reference is " + result.reference + ".");
              } else {
                showStatus("info", "Razorpay authorized the payment; confirmation is pending. Registration reference: " +
                  result.reference + ". The organizers will confirm once capture completes.");
              }
            }).catch(function (error) {
              showStatus("err", error.message || "Payment verification is pending. Contact the organizers if you were charged.");
            }).finally(function () {
              if (button) { button.disabled = false; button.textContent = oldText; }
            });
          },
          modal: {
            ondismiss: function () {
              request("/api/checkout/razorpay/cancel", { orderId: order.orderId }).catch(function () {});
              showStatus("err", "Razorpay checkout was closed. No payment was confirmed; you may try again.");
              if (button) { button.disabled = false; button.textContent = oldText; }
            }
          }
        });
        checkout.on("payment.failed", function (response) {
          showStatus("err", response.error && response.error.description || "Razorpay could not complete the payment.");
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
      request("/api/checkout/paypal/order", data).then(function (order) {
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
      if (result.paid) showStatus("ok", "Payment received. Your registration reference is " + result.reference + ".");
      else showStatus("info", "Your payment is being confirmed. Registration reference: " + result.reference + ".");
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
        showStatus("ok", "Payment received. Your registration reference is " + result.reference + ".");
      } else {
        showStatus("info", result.error || "PayPal payment is still pending. Registration reference: " + result.reference + ".");
      }
    }).catch(function (error) {
      showStatus("err", error.message || "We could not confirm PayPal payment. Contact the organizers if you were charged.");
    });
  }
})();
