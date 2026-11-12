# Payment amount mismatch investigation

## Finding

The reported server quote is internally consistent:

- Items: USD 654.00 + USD 435.00 = USD 1,089.00.
- 12% discount: USD 130.68, applied to the item subtotal.
- Taxable subtotal: USD 958.32.
- 5% tax: USD 47.92 after cent rounding.
- Server total: USD 1,006.24 (100,624 minor units).

The request was rejected before Razorpay order creation by the frontend comparison between its locally calculated hidden `totalPrice` and `/api/checkout/quote`. The old mismatch message showed only the server quote, not the submitted/displayed amount, and did not update the registration summary, so the attendee could not reconcile the amounts.

The code also contained two accommodation price sources. The PHP calculator preferred the shared `accommodation.pricePerNight` value, while the registration page showed the selected occupancy's `registrationPricing.fixedItems.addon_accommodation_single` or `_double` value. If those admin values differed, the client and server legitimately calculated different totals. The report's live database values could not be queried from this local environment, so no claim is made about which stored setting differed on the deployed host.

The local source has no connection to the deployed hosting account's MySQL data. Verify the production content response or admin settings before treating the example USD 654.00 / USD 435.00 rates or a 12% coupon as the actual saved production records.

## Pricing rules after the fix

- The saved occupancy-specific nightly rate is authoritative when present.
- The legacy shared accommodation nightly rate is used only if the selected occupancy-specific rate is absent.
- Virtual category amount is taken from the saved fee for the category's effective registration period.
- One room/occupancy selection is charged for each selected night; there is no separate room-count field in the current form.
- Coupon discount is applied to the item subtotal; 5% tax is applied to the discounted subtotal. Both are rounded to cents.
- The browser sends item selections and coupon code, not trusted prices. The PHP service recalculates from saved content.

For the reported order, if the saved rates are Virtual USD 654.00 and double occupancy USD 435.00 and the coupon is valid for 12%, the server total is USD 1,006.24.

## Changes

- Aligned PHP and legacy Node accommodation rate selection with the occupancy-specific prices displayed in the registration page; retained the shared accommodation price as a fallback for older content records.
- Updated the public form to use the same fallback rule when an occupancy-specific rate is not present.
- When a client/server quote differs, the page now replaces the order summary with the itemized server quote and asks the attendee to explicitly confirm the server total. Declining cancels checkout.
- Provider order responses are compared with the server quote rather than the client-submitted total.
- Razorpay order creation continues to send `RegistrationService::totalCents` as the provider amount and independently checks the returned order amount and currency. No validation was removed or bypassed.
- Clarified the admin accommodation pricing instructions.

## Tests and verification

Added PHP service cases for no accommodation, double occupancy, one-, two-, and three-night pricing, occupancy-specific rate precedence, legacy shared-rate fallback, 12% discount, and tax rounding. These require PHP 8.2+ and PHPUnit, which are unavailable in the current environment; they have not been run here.

Local Node unit tests and JavaScript syntax checks should be run before deployment. The exact production quote still needs verification against the live database's saved Virtual fee, double-occupancy fee, accommodation settings, and coupon record. No live or sandbox Razorpay order was created in this investigation.
