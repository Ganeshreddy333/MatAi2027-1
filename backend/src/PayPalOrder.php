<?php

declare(strict_types=1);

namespace MatAi;

final class PayPalOrder
{
    public static function payload(
        string $reference,
        string $selectedItems,
        string $merchantId,
        int $amountMinor,
        string $currency,
        string $baseUrl
    ): array {
        return [
            'intent' => 'CAPTURE',
            'purchase_units' => [[
                'reference_id' => $reference,
                'custom_id' => $reference,
                'description' => mb_substr($selectedItems, 0, 120),
                'payee' => ['merchant_id' => $merchantId],
                'amount' => [
                    'currency_code' => $currency,
                    'value' => CurrencyPolicy::formatMinorUnits($amountMinor),
                ],
            ]],
            'payment_source' => ['paypal' => ['experience_context' => [
                'brand_name' => 'MatAi 2027',
                'user_action' => 'PAY_NOW',
                'return_url' => rtrim($baseUrl, '/') . '/registration.html?checkout=paypal-return',
                'cancel_url' => rtrim($baseUrl, '/') . '/registration.html?checkout=paypal-cancelled',
            ]]],
        ];
    }

    public static function validateResponse(
        array $order,
        string $reference,
        string $merchantId,
        int $amountMinor,
        string $currency
    ): array {
        $approvalUrl = '';
        $links = $order['links'] ?? [];
        if (is_array($links)) {
            foreach ($links as $link) {
                if (is_array($link) && in_array($link['rel'] ?? '', ['payer-action', 'approve'], true)) {
                    $approvalUrl = (string) ($link['href'] ?? '');
                    break;
                }
            }
        }

        $purchase = null;
        $purchaseUnits = $order['purchase_units'] ?? [];
        if (is_array($purchaseUnits)) {
            foreach ($purchaseUnits as $unit) {
                if (is_array($unit) && ($unit['custom_id'] ?? '') === $reference) {
                    $purchase = $unit;
                    break;
                }
            }
        }
        $payee = is_array($purchase['payee'] ?? null) ? $purchase['payee'] : [];
        $amount = is_array($purchase['amount'] ?? null) ? $purchase['amount'] : [];

        $checks = [
            'has_order_id' => !empty($order['id']),
            'has_approval_url' => self::isPayPalUrl($approvalUrl),
            'purchase_unit_matched' => $purchase !== null,
            'merchant_matched' => $purchase !== null
                && ($payee['merchant_id'] ?? '') === $merchantId,
            'amount_currency_matched' => $purchase !== null && CurrencyPolicy::paymentMatches(
                CurrencyPolicy::formatMinorUnits($amountMinor),
                $currency,
                $amount['value'] ?? null,
                $amount['currency_code'] ?? ''
            ),
        ];

        return [
            'valid' => !in_array(false, $checks, true),
            'approvalUrl' => !in_array(false, $checks, true) ? $approvalUrl : '',
            'checks' => $checks,
        ];
    }

    private static function isPayPalUrl(string $url): bool
    {
        $host = parse_url($url, PHP_URL_HOST);
        return parse_url($url, PHP_URL_SCHEME) === 'https'
            && is_string($host)
            && (strtolower($host) === 'paypal.com' || str_ends_with(strtolower($host), '.paypal.com'));
    }
}
