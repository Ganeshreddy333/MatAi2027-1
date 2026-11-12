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
        self::assertFalse(CurrencyPolicy::paymentMatches('105.001', 'USD', '105.00', 'USD'));
        self::assertTrue(CurrencyPolicy::paymentMatches('105.10', 'USD', 105.1, 'USD'));
    }

    public function testMinorUnitPaymentComparisonDoesNotConvertProviderAmountsToFloats(): void
    {
        self::assertTrue(CurrencyPolicy::paymentMatchesMinorUnits(10510, 'USD', 10510, 'usd'));
        self::assertFalse(CurrencyPolicy::paymentMatchesMinorUnits(10510, 'USD', 10509, 'USD'));
        self::assertFalse(CurrencyPolicy::paymentMatchesMinorUnits(-1, 'USD', 10510, 'USD'));
        self::assertFalse(CurrencyPolicy::paymentMatchesMinorUnits(10510, 'USD', '10510', 'USD'));
        self::assertSame('105.10', CurrencyPolicy::formatMinorUnits(10510));
    }
}
