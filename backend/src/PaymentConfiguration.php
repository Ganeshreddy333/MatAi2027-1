<?php

declare(strict_types=1);

namespace MatAi;

final class PaymentConfiguration
{
    public static function stripeEnabled(string $secret, string $eurCheckoutVerified): bool
    {
        return $secret !== '' && strtolower(trim($eurCheckoutVerified)) === 'true';
    }

    public static function paypalEnabled(string $clientId, string $clientSecret, string $eurCheckoutVerified): bool
    {
        return $clientId !== '' && $clientSecret !== '' && strtolower(trim($eurCheckoutVerified)) === 'true';
    }

    public static function razorpayEnabled(
        string $keyId,
        string $keySecret,
        string $currency,
        string $eurCheckoutVerified = ''
    ): bool {
        return $keyId !== '' && $keySecret !== '' && $currency === 'EUR'
            && strtolower(trim($eurCheckoutVerified)) === 'true';
    }
}
