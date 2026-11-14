<?php

declare(strict_types=1);

namespace MatAi\Tests;

use MatAi\PayPalOrder;
use PHPUnit\Framework\TestCase;

final class PayPalOrderTest extends TestCase
{
    public function testBuildsOrderPayloadFromServerCalculatedAmount(): void
    {
        $payload = PayPalOrder::payload(
            'MATAI-ORDER123',
            'Student registration',
            'merchant-123',
            12550,
            'USD',
            'https://matai2027.com/'
        );

        self::assertSame('CAPTURE', $payload['intent']);
        self::assertSame('MATAI-ORDER123', $payload['purchase_units'][0]['custom_id']);
        self::assertSame('merchant-123', $payload['purchase_units'][0]['payee']['merchant_id']);
        self::assertSame('125.50', $payload['purchase_units'][0]['amount']['value']);
        self::assertSame('USD', $payload['purchase_units'][0]['amount']['currency_code']);
        self::assertSame(
            'https://matai2027.com/registration.html?checkout=paypal-return',
            $payload['payment_source']['paypal']['experience_context']['return_url']
        );
    }

    public function testAcceptsMatchingProviderOrderResponse(): void
    {
        $result = PayPalOrder::validateResponse($this->validOrder(), 'MATAI-ORDER123', 'merchant-123', 12550, 'USD');

        self::assertTrue($result['valid']);
        self::assertSame('https://www.paypal.com/checkoutnow?token=order123', $result['approvalUrl']);
    }

    public function testRejectsMismatchedAmountAndCurrency(): void
    {
        $order = $this->validOrder();
        $order['purchase_units'][0]['amount'] = ['value' => '125.49', 'currency_code' => 'EUR'];

        $result = PayPalOrder::validateResponse($order, 'MATAI-ORDER123', 'merchant-123', 12550, 'USD');

        self::assertFalse($result['valid']);
        self::assertFalse($result['checks']['amount_currency_matched']);
        self::assertSame('', $result['approvalUrl']);
    }

    public function testRejectsWrongMerchantAndUntrustedApprovalUrl(): void
    {
        $order = $this->validOrder();
        $order['purchase_units'][0]['payee']['merchant_id'] = 'another-merchant';
        $order['links'][0]['href'] = 'https://paypal.example.invalid/checkout';

        $result = PayPalOrder::validateResponse($order, 'MATAI-ORDER123', 'merchant-123', 12550, 'USD');

        self::assertFalse($result['valid']);
        self::assertFalse($result['checks']['merchant_matched']);
        self::assertFalse($result['checks']['has_approval_url']);
    }

    public function testRejectsOrderWithoutMatchingRegistrationReference(): void
    {
        $order = $this->validOrder();
        $order['purchase_units'][0]['custom_id'] = 'different-registration';

        $result = PayPalOrder::validateResponse($order, 'MATAI-ORDER123', 'merchant-123', 12550, 'USD');

        self::assertFalse($result['valid']);
        self::assertFalse($result['checks']['purchase_unit_matched']);
    }

    private function validOrder(): array
    {
        return [
            'id' => 'ORDER-123',
            'links' => [[
                'rel' => 'approve',
                'href' => 'https://www.paypal.com/checkoutnow?token=order123',
            ]],
            'purchase_units' => [[
                'custom_id' => 'MATAI-ORDER123',
                'payee' => ['merchant_id' => 'merchant-123'],
                'amount' => ['value' => '125.50', 'currency_code' => 'USD'],
            ]],
        ];
    }
}
