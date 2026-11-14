<?php

declare(strict_types=1);

namespace MatAi\Tests;

use MatAi\PaymentConfiguration;
use PHPUnit\Framework\TestCase;

final class PaymentConfigurationTest extends TestCase
{
    public function testPayPalProductionModeSelectsLiveAndSandboxModeStaysSandbox(): void
    {
        self::assertSame('live', PaymentConfiguration::paypalMode('production'));
        self::assertSame('live', PaymentConfiguration::paypalMode(' LIVE '));
        self::assertSame('sandbox', PaymentConfiguration::paypalMode('sandbox'));
        self::assertSame('sandbox', PaymentConfiguration::paypalMode('test'));
    }

    public function testPayPalRejectsUnknownModeInsteadOfSilentlyUsingSandbox(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        PaymentConfiguration::paypalMode('prod');
    }

    public function testRazorpayRequiresCredentialsAndUsdBillingCurrency(): void
    {
        self::assertTrue(PaymentConfiguration::razorpayEnabled('key-id', 'key-secret', 'USD', 'true'));
        self::assertTrue(PaymentConfiguration::razorpayEnabled('key-id', 'key-secret', ' usd ', 'true'));
        self::assertFalse(PaymentConfiguration::razorpayEnabled('', 'key-secret', 'USD'));
        self::assertFalse(PaymentConfiguration::razorpayEnabled('key-id', '', 'USD'));
        self::assertFalse(PaymentConfiguration::razorpayEnabled('key-id', 'key-secret', 'INR'));
        self::assertTrue(PaymentConfiguration::razorpayEnabled('key-id', 'key-secret', 'usd', 'true'));
        self::assertFalse(PaymentConfiguration::razorpayEnabled('key-id', 'key-secret', 'USD', 'false'));
    }

    public function testStripeAndPaypalRequireExplicitUsdVerification(): void
    {
        self::assertTrue(PaymentConfiguration::stripeEnabled('stripe-secret', 'true'));
        self::assertFalse(PaymentConfiguration::stripeEnabled('stripe-secret', 'false'));
        self::assertTrue(PaymentConfiguration::paypalEnabled(
            'client-id',
            'client-secret',
            'true',
            'merchant-id',
            'webhook-id'
        ));
        self::assertFalse(PaymentConfiguration::paypalEnabled(
            'client-id',
            'client-secret',
            'false',
            'merchant-id',
            'webhook-id'
        ));
        self::assertFalse(PaymentConfiguration::paypalEnabled('client-id', 'client-secret', 'true'));
    }
}
