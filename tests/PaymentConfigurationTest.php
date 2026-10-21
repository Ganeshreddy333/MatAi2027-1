<?php

declare(strict_types=1);

namespace MatAi\Tests;

use MatAi\PaymentConfiguration;
use PHPUnit\Framework\TestCase;

final class PaymentConfigurationTest extends TestCase
{
    public function testRazorpayRequiresCredentialsAndEurBillingCurrency(): void
    {
        self::assertTrue(PaymentConfiguration::razorpayEnabled('key-id', 'key-secret', 'EUR'));
        self::assertFalse(PaymentConfiguration::razorpayEnabled('', 'key-secret', 'EUR'));
        self::assertFalse(PaymentConfiguration::razorpayEnabled('key-id', '', 'EUR'));
        self::assertFalse(PaymentConfiguration::razorpayEnabled('key-id', 'key-secret', 'INR'));
        self::assertFalse(PaymentConfiguration::razorpayEnabled('key-id', 'key-secret', 'eur'));
    }
}
