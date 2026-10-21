<?php

declare(strict_types=1);

namespace MatAi;

use DomainException;

final class RegistrationService
{
    private const REQUIRED = ['fullName', 'email', 'period', 'institution', 'country'];
    private const PERIODS = ['Early Bird', 'Mid-Term', 'On-Spot'];
    private const ITEMS = [
        ['qty_speaker', 'Speaker Registration', 'Speaker'],
        ['qty_delegate', 'Delegate Registration', 'Delegate'],
        ['qty_poster', 'Poster Presentation', 'Poster'],
        ['qty_student', 'Student Registration', 'Student'],
        ['qty_virtual', 'Virtual Registration', 'Virtual'],
        ['qty_ex_standard', 'Standard Exhibition Booth (3 x 2 m)', 'exhibition_standard'],
        ['qty_ex_premium', 'Premium Exhibition Booth (3 x 3 m)', 'exhibition_premium'],
        ['qty_ex_startup', 'Start-Up Pavilion', 'exhibition_startup'],
        ['qty_sp_diamond', 'Diamond Sponsor', 'sponsor_diamond'],
        ['qty_sp_platinum', 'Platinum Sponsor', 'sponsor_platinum'],
        ['qty_sp_gold', 'Gold Sponsor', 'sponsor_gold'],
        ['qty_sp_silver', 'Silver Sponsor', 'sponsor_silver'],
        ['qty_sp_bronze', 'Bronze / Supporting Sponsor', 'sponsor_bronze'],
        ['qty_ss_keynote', 'Keynote Session Sponsor', 'sponsor_keynote'],
        ['qty_ss_plenary', 'Plenary Session Sponsor', 'sponsor_plenary'],
        ['qty_ss_advertising', 'Advertising Sponsor', 'sponsor_advertising'],
        ['qty_ss_coffee', 'Coffee Break Sponsor', 'sponsor_coffee'],
        ['qty_ss_lunch', 'Lunch Sponsor (per day)', 'sponsor_lunch'],
        ['qty_ss_reception', 'Conference Reception Sponsor', 'sponsor_reception'],
        ['qty_ss_kit', 'Conference Kit Sponsor', 'sponsor_kit'],
        ['qty_ss_lanyard', 'Lanyard & Badge Sponsor', 'sponsor_lanyard'],
        ['qty_ss_awards', 'Awards & Young Researcher Sponsor', 'sponsor_awards'],
        ['qty_ss_insert', 'Delegate Kit Insert', 'sponsor_insert'],
        ['qty_ss_industry', 'Industry Presentation', 'sponsor_industry'],
        ['qty_social', 'Social & Networking Event', 'addon_social'],
        ['qty_accompanying', 'Accompanying Person', 'addon_accompanying'],
        ['qty_accom_single', 'Accommodation — Single Occupancy', 'addon_accommodation_single'],
        ['qty_accom_double', 'Accommodation — Double Occupancy', 'addon_accommodation_double'],
    ];

    public function __construct(private readonly Store $store)
    {
    }

    public function prepare(array $input): array
    {
        $data = $this->sanitize($input);
        foreach (self::REQUIRED as $field) {
            if (!isset($data[$field]) || trim((string) $data[$field]) === '') {
                throw new DomainException('Missing required field: ' . $field);
            }
        }
        if (!filter_var($data['email'], FILTER_VALIDATE_EMAIL)) {
            throw new DomainException('Invalid email address.');
        }
        if (!in_array($data['terms'] ?? null, [true, 'on', 'true', '1', 1], true)) {
            throw new DomainException('You must accept the registration terms.');
        }
        $gateway = (string) ($data['paymentGateway'] ?? '');
        if (!in_array($gateway, ['Stripe / Card Payment', 'PayPal', 'Razorpay', 'Bank Transfer'], true)) {
            throw new DomainException('Select a valid payment method.');
        }

        $content = $this->withDefaults($this->store->content());
        $period = $this->effectivePeriod($content['registrationPeriods'] ?? []);
        $items = [];
        $grossCents = 0;
        $participantCount = 0;
        foreach (self::ITEMS as [$field, $label, $priceKey]) {
            $raw = (string) ($data[$field] ?? '0');
            if (!preg_match('/^\d{1,3}$/', $raw) || (int) $raw > 100) {
                throw new DomainException('Invalid quantity for ' . $label . '.');
            }
            $quantity = (int) $raw;
            if ($quantity === 0) {
                continue;
            }
            $category = in_array($priceKey, ['Speaker', 'Delegate', 'Poster', 'Student', 'Virtual'], true)
                ? $priceKey
                : null;
            $price = $category !== null
                ? ($content['fees'][$period][$category] ?? null)
                : ($content['registrationPricing']['fixedItems'][$priceKey] ?? null);
            if (!is_numeric($price) || (float) $price < 0 || (float) $price > 1000000) {
                throw new DomainException('The configured price for ' . $label . ' is invalid.');
            }
            $unitCents = (int) round((float) $price * 100);
            $grossCents += $unitCents * $quantity;
            if ($category !== null) {
                $participantCount += $quantity;
            }
            $items[] = ['name' => $label, 'category' => $category ?? '', 'quantity' => $quantity, 'unitCents' => $unitCents];
        }
        if ($items === [] || $grossCents <= 0 || $grossCents > 99999999) {
            throw new DomainException('Select one or more registration items with a valid total below €1,000,000.');
        }

        $discountPercent = 0.0;
        $couponCode = strtoupper(trim((string) ($data['couponCode'] ?? '')));
        if ($couponCode !== '') {
            $coupon = null;
            foreach ($content['coupons'] as $candidate) {
                if (is_array($candidate) && ($candidate['enabled'] ?? true) !== false
                    && strtoupper(trim((string) ($candidate['code'] ?? ''))) === $couponCode) {
                    $coupon = $candidate;
                    break;
                }
            }
            $percent = $coupon['percent'] ?? null;
            if (!is_numeric($percent) || (float) $percent <= 0 || (float) $percent > 100) {
                throw new DomainException('The coupon code is invalid or expired.');
            }
            $discountPercent = (float) $percent / 100;
        }
        $discountCents = (int) round($grossCents * $discountPercent);
        $subtotalCents = max(0, $grossCents - $discountCents);
        $taxCents = (int) round($subtotalCents * 0.05);
        $totalCents = $subtotalCents + $taxCents;
        $amount = $totalCents / 100;
        $data['period'] = $period;
        $data['participantCount'] = $participantCount;
        $data['category'] = implode(', ', array_column(array_filter($items, static fn (array $item): bool => $item['category'] !== ''), 'name'))
            ?: 'Add-ons only';
        $data['selectedItems'] = implode('; ', array_map(
            static fn (array $item): string => $item['name'] . ' x' . $item['quantity'],
            $items
        ));
        $data['totalPrice'] = number_format($amount, 2, '.', '');
        $data['totalPriceEUR'] = $data['totalPrice'];
        $data['taxRate'] = 0.05;
        $data['taxAmount'] = number_format($taxCents / 100, 2, '.', '');
        $data['paymentMethod'] = $gateway;

        return compact('data', 'items', 'amount', 'totalCents', 'grossCents', 'discountCents', 'taxCents', 'period');
    }

    public function effectivePeriod(array $periods): string
    {
        $index = array_search($periods['active'] ?? '', self::PERIODS, true);
        $index = $index === false ? 0 : $index;
        $today = gmdate('Y-m-d');
        while ($index < count(self::PERIODS) - 1) {
            $current = $periods[self::PERIODS[$index]] ?? [];
            $deadline = is_array($current) ? ($current['deadline'] ?? '') : '';
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $deadline) || $deadline >= $today) {
                break;
            }
            $index++;
        }
        return self::PERIODS[$index];
    }

    private function withDefaults(array $content): array
    {
        $defaults = [
            'registrationPeriods' => [
                'active' => 'Early Bird',
                'Early Bird' => ['deadline' => 'To Be Announced'],
                'Mid-Term' => ['deadline' => 'To Be Announced'],
                'On-Spot' => ['deadline' => 'To Be Announced'],
            ],
            'fees' => [
                'Early Bird' => ['Speaker' => 649, 'Delegate' => 749, 'Poster' => 549, 'Student' => 399, 'Virtual' => 299],
                'Mid-Term' => ['Speaker' => 749, 'Delegate' => 849, 'Poster' => 649, 'Student' => 499, 'Virtual' => 399],
                'On-Spot' => ['Speaker' => 849, 'Delegate' => 949, 'Poster' => 749, 'Student' => 599, 'Virtual' => 499],
            ],
            'registrationPricing' => ['fixedItems' => []],
            'coupons' => [],
        ];
        foreach ($defaults as $key => $value) {
            if (!isset($content[$key]) || !is_array($content[$key])) {
                $content[$key] = $value;
            }
        }
        foreach ($defaults['fees'] as $period => $categories) {
            $savedFees = $this->arrayValue($content['fees'][$period] ?? null);
            $content['fees'][$period] = array_merge($categories, $savedFees);
        }
        $content['registrationPeriods'] = array_replace_recursive(
            $defaults['registrationPeriods'],
            $content['registrationPeriods']
        );
        $fixedItems = $this->arrayValue($content['registrationPricing']['fixedItems'] ?? null);
        $content['registrationPricing']['fixedItems'] = array_merge(
            $defaults['registrationPricing']['fixedItems'],
            $fixedItems
        );
        return $content;
    }

    private function arrayValue(mixed $value): array
    {
        return is_array($value) ? $value : [];
    }

    private function sanitize(array $input): array
    {
        $result = [];
        foreach ($input as $key => $value) {
            if (!is_string($key) || $key === '') {
                continue;
            }
            if (is_scalar($value) || $value === null) {
                $result[$key] = is_string($value) ? mb_substr($value, 0, 5000) : $value;
            }
        }
        return $result;
    }
}
