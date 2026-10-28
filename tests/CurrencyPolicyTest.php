<?php

declare(strict_types=1);

namespace MatAi\Tests;

use MatAi\CurrencyPolicy;
use PHPUnit\Framework\TestCase;

final class CurrencyPolicyTest extends TestCase
{
    public function testPaymentMustMatchExpectedAmountAndCurrency(): void
    {
        self::assertTrue(CurrencyPolicy::paymentMatches(105.00, 'EUR', 105, 'eur'));
        self::assertFalse(CurrencyPolicy::paymentMatches(105.00, 'EUR', 104.99, 'EUR'));
        self::assertFalse(CurrencyPolicy::paymentMatches(105.00, 'EUR', 105.00, 'USD'));
        self::assertFalse(CurrencyPolicy::paymentMatches(105.00, 'EUR', -1, 'EUR'));
    }
}
