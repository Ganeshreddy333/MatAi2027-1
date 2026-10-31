<?php

declare(strict_types=1);

namespace MatAi\Tests;

use MatAi\CurrencyPolicy;
use PHPUnit\Framework\TestCase;

final class CurrencyPolicyTest extends TestCase
{
    public function testPaymentMustMatchExpectedAmountAndCurrency(): void
    {
        self::assertTrue(CurrencyPolicy::paymentMatches(105.00, 'USD', 105, 'usd'));
        self::assertFalse(CurrencyPolicy::paymentMatches(105.00, 'USD', 104.99, 'USD'));
        self::assertFalse(CurrencyPolicy::paymentMatches(105.00, 'USD', 105.00, 'EUR'));
        self::assertFalse(CurrencyPolicy::paymentMatches(105.00, 'USD', -1, 'USD'));
    }
}
