<?php

declare(strict_types=1);

namespace MatAi\Tests;

use MatAi\ReceiptPdf;
use PHPUnit\Framework\TestCase;

final class ReceiptPdfTest extends TestCase
{
    public function testVerifiedReceiptPdfContainsPaymentAndConferenceDetails(): void
    {
        $pdf = ReceiptPdf::render([
            'receiptNumber' => 'MATAI-2027-ABC123',
            'currency' => 'USD',
            'amountMinor' => 100624,
            'paymentMethod' => 'Razorpay / card',
            'paymentId' => 'pay_verified',
            'orderId' => 'order_verified',
            'paidAt' => '2027-01-02 03:04:05 UTC',
            'participant' => [
                'name' => 'Ada Example',
                'email' => 'ada@example.test',
                'phone' => '+1 555 0100',
                'institution' => 'Example University',
                'cityCountry' => 'Berlin, Germany',
            ],
            'registration' => ['category' => 'Virtual Registration', 'participants' => 1],
            'items' => [[
                'name' => 'Virtual Registration',
                'quantity' => 1,
                'unitCents' => 65400,
                'lineTotalCents' => 65400,
            ]],
            'accommodation' => [
                'type' => 'double',
                'nights' => 1,
                'checkInDate' => '2027-10-12',
                'checkOutDate' => '2027-10-13',
            ],
            'pricing' => [
                'grossCents' => 108900,
                'couponCode' => 'SAVE12',
                'discountCents' => 13068,
                'taxCents' => 4792,
                'taxRateBasisPoints' => 500,
            ],
        ]);

        self::assertStringStartsWith('%PDF-1.4', $pdf);
        self::assertStringContainsString('%%EOF', $pdf);
        foreach ([
            'PAYMENT RECEIPT',
            'MATAI-2027-ABC123',
            'Ada Example',
            'ada@example.test',
            'Virtual Registration',
            'SAVE12',
            'USD 1006.24',
            'pay_verified',
            'order_verified',
            'October 13',
            'Venue to be announced',
        ] as $expected) {
            self::assertStringContainsString($expected, $pdf);
        }
    }

    public function testReceiptPdfEscapesPdfStringDelimiters(): void
    {
        $pdf = ReceiptPdf::render([
            'currency' => 'USD',
            'participant' => ['name' => 'A (B) \\ C'],
            'items' => [],
            'accommodation' => [],
            'pricing' => [],
        ]);

        self::assertStringContainsString('A \\(B\\) \\\\ C', $pdf);
    }
}
