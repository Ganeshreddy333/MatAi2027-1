<?php

declare(strict_types=1);

namespace MatAi\Tests;

use MatAi\PaymentConfiguration;
use PHPUnit\Framework\TestCase;

final class PaymentConfigurationTest extends TestCase
{
    public function testRazorpayRequiresCredentialsAndEurBillingCurrency(): void
    {
        self::assertTrue(PaymentConfiguration::razorpayEnabled('key-id', 'key-secret', 'EUR', 'true'));
        self::assertFalse(PaymentConfiguration::razorpayEnabled('', 'key-secret', 'EUR'));
        self::assertFalse(PaymentConfiguration::razorpayEnabled('key-id', '', 'EUR'));
        self::assertFalse(PaymentConfiguration::razorpayEnabled('key-id', 'key-secret', 'INR'));
        self::assertFalse(PaymentConfiguration::razorpayEnabled('key-id', 'key-secret', 'eur'));
        self::assertFalse(PaymentConfiguration::razorpayEnabled('key-id', 'key-secret', 'EUR', 'false'));
    }

    public function testStripeAndPaypalRequireExplicitEurVerification(): void
    {
        self::assertTrue(PaymentConfiguration::stripeEnabled('stripe-secret', 'true'));
        self::assertFalse(PaymentConfiguration::stripeEnabled('stripe-secret', 'false'));
        self::assertTrue(PaymentConfiguration::paypalEnabled('client-id', 'client-secret', 'true'));
        self::assertFalse(PaymentConfiguration::paypalEnabled('client-id', 'client-secret', 'false'));
    }
}
