<?php

declare(strict_types=1);

namespace MatAi;

final class PaymentConfiguration
{
    public static function razorpayEnabled(string $keyId, string $keySecret, string $currency): bool
    {
        return $keyId !== '' && $keySecret !== '' && $currency === 'EUR';
    }
}
