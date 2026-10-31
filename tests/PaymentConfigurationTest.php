<?php

declare(strict_types=1);

namespace MatAi\Tests;

use MatAi\PaymentConfiguration;
use PHPUnit\Framework\TestCase;

final class PaymentConfigurationTest extends TestCase
{
    public function testRazorpayRequiresCredentialsAndUsdBillingCurrency(): void
    {
        self::assertTrue(PaymentConfiguration::razorpayEnabled('key-id', 'key-secret', 'USD', 'true'));
        self::assertFalse(PaymentConfiguration::razorpayEnabled('', 'key-secret', 'USD'));
        self::assertFalse(PaymentConfiguration::razorpayEnabled('key-id', '', 'USD'));
        self::assertFalse(PaymentConfiguration::razorpayEnabled('key-id', 'key-secret', 'INR'));
        self::assertFalse(PaymentConfiguration::razorpayEnabled('key-id', 'key-secret', 'usd'));
        self::assertFalse(PaymentConfiguration::razorpayEnabled('key-id', 'key-secret', 'USD', 'false'));
    }

    public function testStripeAndPaypalRequireExplicitUsdVerification(): void
    {
        self::assertTrue(PaymentConfiguration::stripeEnabled('stripe-secret', 'true'));
        self::assertFalse(PaymentConfiguration::stripeEnabled('stripe-secret', 'false'));
        self::assertTrue(PaymentConfiguration::paypalEnabled('client-id', 'client-secret', 'true'));
        self::assertFalse(PaymentConfiguration::paypalEnabled('client-id', 'client-secret', 'false'));
    }
}
