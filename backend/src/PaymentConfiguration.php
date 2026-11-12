<?php

declare(strict_types=1);

namespace MatAi;

final class PaymentConfiguration
{
    public static function stripeEnabled(string $secret, string $usdCheckoutVerified): bool
    {
        return $secret !== '' && strtolower(trim($usdCheckoutVerified)) === 'true';
    }

    public static function paypalEnabled(
        string $clientId,
        string $clientSecret,
        string $usdCheckoutVerified,
        string $merchantId = '',
        string $webhookId = ''
    ): bool {
        return $clientId !== '' && $clientSecret !== '' && $merchantId !== '' && $webhookId !== ''
            && strtolower(trim($usdCheckoutVerified)) === 'true';
    }

    public static function razorpayEnabled(
        string $keyId,
        string $keySecret,
        string $currency,
        string $usdCheckoutVerified = ''
    ): bool {
        $normalizedCurrency = strtoupper(trim($currency));
        return $keyId !== '' && $keySecret !== '' && $normalizedCurrency === 'USD'
            && strtolower(trim($usdCheckoutVerified)) === 'true';
    }
}
