<?php

declare(strict_types=1);

namespace MatAi;

final class ReceiptPdf
{
    public static function render(array $receipt): string
    {
        $currency = self::text($receipt['currency'] ?? '');
        $participant = is_array($receipt['participant'] ?? null) ? $receipt['participant'] : [];
        $registration = is_array($receipt['registration'] ?? null) ? $receipt['registration'] : [];
        $accommodation = is_array($receipt['accommodation'] ?? null) ? $receipt['accommodation'] : [];
        $pricing = is_array($receipt['pricing'] ?? null) ? $receipt['pricing'] : [];
        $rows = [
            ['MatAI 2027', 'title'],
            ['PAYMENT RECEIPT', 'subtitle'],
            ['Receipt number: ' . self::text($receipt['receiptNumber'] ?? ''), 'normal'],
            ['Payment status: VERIFIED / PAID', 'normal'],
            ['', 'gap'],
            ['PARTICIPANT', 'section'],
            ['Name: ' . self::text($participant['name'] ?? ''), 'normal'],
            ['Email: ' . self::text($participant['email'] ?? ''), 'normal'],
            ['Phone: ' . self::text($participant['phone'] ?? ''), 'normal'],
            ['Institution: ' . self::text($participant['institution'] ?? ''), 'normal'],
            ['City / Country: ' . self::text($participant['cityCountry'] ?? ''), 'normal'],
            ['Registration category: ' . self::text($registration['category'] ?? ''), 'normal'],
            ['Number of participants: ' . (int) ($registration['participants'] ?? 0), 'normal'],
            ['', 'gap'],
            ['REGISTRATION ITEMS', 'section'],
        ];

        foreach (is_array($receipt['items'] ?? null) ? $receipt['items'] : [] as $item) {
            if (!is_array($item)) {
                continue;
            }
            $quantity = max(0, (int) ($item['quantity'] ?? 0));
            $unitCents = max(0, (int) ($item['unitCents'] ?? 0));
            $lineCents = max(0, (int) ($item['lineTotalCents'] ?? $unitCents * $quantity));
            $rows[] = [
                self::text($item['name'] ?? 'Item') . ' x' . $quantity .
                    '  @ ' . self::money($unitCents, $currency) .
                    '  = ' . self::money($lineCents, $currency),
                'normal',
            ];
        }

        $rows = array_merge($rows, [
            ['', 'gap'],
            ['ACCOMMODATION', 'section'],
            ['Type: ' . (($accommodation['type'] ?? '') !== '' ? ucfirst(self::text($accommodation['type'])) : 'None'), 'normal'],
            ['Nights: ' . max(0, (int) ($accommodation['nights'] ?? 0)), 'normal'],
            [
                'Check-in / Check-out: ' .
                    (self::text($accommodation['checkInDate'] ?? '') ?: '—') . ' / ' .
                    (self::text($accommodation['checkOutDate'] ?? '') ?: '—'),
                'normal',
            ],
            ['', 'gap'],
            ['PAYMENT SUMMARY', 'section'],
            ['Subtotal: ' . self::money((int) ($pricing['grossCents'] ?? 0), $currency), 'normal'],
            ['Coupon: ' . (self::text($pricing['couponCode'] ?? '') ?: 'None'), 'normal'],
            ['Discount: -' . self::money((int) ($pricing['discountCents'] ?? 0), $currency), 'normal'],
            [
                'Tax (' . number_format((int) ($pricing['taxRateBasisPoints'] ?? 0) / 100, 2) . '%): ' .
                    self::money((int) ($pricing['taxCents'] ?? 0), $currency),
                'normal',
            ],
            ['AMOUNT PAID: ' . self::money((int) ($receipt['amountMinor'] ?? 0), $currency), 'total'],
            ['Currency: ' . $currency, 'normal'],
            ['Payment method: ' . self::text($receipt['paymentMethod'] ?? 'Razorpay'), 'normal'],
            ['Razorpay Payment ID: ' . self::text($receipt['paymentId'] ?? ''), 'normal'],
            ['Razorpay Order ID: ' . self::text($receipt['orderId'] ?? ''), 'normal'],
            ['Transaction date/time (UTC): ' . self::text($receipt['paidAt'] ?? ''), 'normal'],
            ['', 'gap'],
            ['MatAI 2027 Conference | October 13-14, 2027 | Venue to be announced, Berlin, Germany', 'footer'],
            ['This receipt records a payment verified with Razorpay.', 'footer'],
        ]);

        $wrappedRows = [];
        foreach ($rows as [$value, $style]) {
            if ($style === 'gap') {
                $wrappedRows[] = ['', 'gap'];
                continue;
            }
            foreach (explode("\n", wordwrap(self::text($value), 88, "\n", true)) as $line) {
                $wrappedRows[] = [$line, $style];
            }
        }

        $pages = array_chunk($wrappedRows, 38);
        $objects = [];
        $pageIds = [];
        $nextObjectId = 5;
        foreach ($pages as $pageRows) {
            $pageId = $nextObjectId++;
            $streamId = $nextObjectId++;
            $pageIds[] = $pageId;
            $content = "0.12 0.30 0.23 rg 0 744 612 48 re f\n";
            $y = 766;

            foreach ($pageRows as [$line, $style]) {
                if ($style === 'gap') {
                    $y -= 7;
                    continue;
                }
                [$font, $size, $color] = match ($style) {
                    'title' => ['F2', 20, '1 1 1'],
                    'subtitle' => ['F2', 13, '0.12 0.30 0.23'],
                    'section' => ['F2', 11, '0.12 0.30 0.23'],
                    'total' => ['F2', 13, '0.12 0.30 0.23'],
                    'footer' => ['F1', 8, '0.35 0.35 0.35'],
                    default => ['F1', 10, '0.10 0.10 0.10'],
                };
                $x = $style === 'title' ? 42 : 48;
                $content .= $color . " rg BT /" . $font . ' ' . $size . ' Tf 1 0 0 1 ' . $x . ' ' . $y .
                    ' Tm (' . self::escapePdfString($line) . ") Tj ET\n";
                $y -= $style === 'title' ? 20 : 16;
            }

            $content .= "0.12 0.30 0.23 RG 48 42 m 564 42 l S\n";
            $objects[$pageId] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources ' .
                '<< /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' . $streamId . ' 0 R >>';
            $objects[$streamId] = '<< /Length ' . strlen($content) . " >>\nstream\n" . $content . "endstream";
        }

        $objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
        $kids = implode(' ', array_map(static fn (int $id): string => $id . ' 0 R', $pageIds));
        $objects[2] = '<< /Type /Pages /Kids [' . $kids . '] /Count ' . count($pageIds) . ' >>';
        $objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
        $objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
        ksort($objects);

        $pdf = "%PDF-1.4\n";
        $offsets = [0];
        foreach ($objects as $id => $object) {
            $offsets[$id] = strlen($pdf);
            $pdf .= $id . " 0 obj\n" . $object . "\nendobj\n";
        }
        $xrefOffset = strlen($pdf);
        $size = max(array_keys($objects)) + 1;
        $pdf .= "xref\n0 " . $size . "\n0000000000 65535 f \n";
        for ($id = 1; $id < $size; $id++) {
            $pdf .= sprintf("%010d 00000 n \n", $offsets[$id] ?? 0);
        }

        return $pdf . "trailer\n<< /Size " . $size . " /Root 1 0 R >>\nstartxref\n" .
            $xrefOffset . "\n%%EOF\n";
    }

    private static function money(int $minor, string $currency): string
    {
        $minor = max(0, $minor);
        return $currency . ' ' . intdiv($minor, 100) . '.' . str_pad((string) ($minor % 100), 2, '0', STR_PAD_LEFT);
    }

    private static function text(mixed $value): string
    {
        if (!is_scalar($value)) {
            return '';
        }
        $text = (string) $value;
        if (function_exists('iconv')) {
            $ascii = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $text);
            if ($ascii !== false) {
                $text = $ascii;
            }
        }
        return preg_replace('/[^\x20-\x7E]/', '', $text) ?? '';
    }

    private static function escapePdfString(string $value): string
    {
        return str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], $value);
    }
}
