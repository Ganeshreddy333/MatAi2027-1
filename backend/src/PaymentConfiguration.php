<?php

declare(strict_types=1);

namespace MatAi;

final class PaymentConfiguration
{
    public static function stripeEnabled(string $secret, string $usdCheckoutVerified): bool
    {
        return $secret !== '' && strtolower(trim($usdCheckoutVerified)) === 'true';
    }

    public static function paypalEnabled(string $clientId, string $clientSecret, string $usdCheckoutVerified): bool
    {
        return $clientId !== '' && $clientSecret !== '' && strtolower(trim($usdCheckoutVerified)) === 'true';
    }

    public static function razorpayEnabled(
        string $keyId,
        string $keySecret,
        string $currency,
        string $usdCheckoutVerified = ''
    ): bool {
        return $keyId !== '' && $keySecret !== '' && $currency === 'USD'
            && strtolower(trim($usdCheckoutVerified)) === 'true';
    }
}
