<?php

declare(strict_types=1);

namespace MatAi\Tests;

use DomainException;
use MatAi\RegistrationService;
use MatAi\Store;
use PHPUnit\Framework\TestCase;

final class RegistrationServiceTest extends TestCase
{
    private string $dataDirectory;
    private RegistrationService $service;

    protected function setUp(): void
    {
        $this->dataDirectory = sys_get_temp_dir() . '/matai-test-' . bin2hex(random_bytes(8));
        mkdir($this->dataDirectory, 0700, true);
        $content = [
            'fees' => ['Early Bird' => ['Speaker' => 100]],
            'registrationPeriods' => ['active' => 'Early Bird'],
            'registrationPricing' => ['fixedItems' => []],
            'coupons' => [['code' => 'SAVE10', 'percent' => 10, 'enabled' => true]],
        ];
        file_put_contents($this->dataDirectory . '/content.json', json_encode($content, JSON_THROW_ON_ERROR));
        $this->service = new RegistrationService(new Store(null, $this->dataDirectory));
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dataDirectory . '/*') ?: [] as $path) {
            unlink($path);
        }
        rmdir($this->dataDirectory);
    }

    public function testRegistrationAmountIsCalculatedFromSavedPricing(): void
    {
        $registration = $this->service->prepare($this->validInput());

        self::assertSame(10500, $registration['totalCents']);
        self::assertSame('105.00', $registration['data']['totalPrice']);
        self::assertSame('Early Bird', $registration['period']);
    }

    public function testCouponIsAppliedBeforeTax(): void
    {
        $input = $this->validInput();
        $input['couponCode'] = 'save10';

        $registration = $this->service->prepare($input);

        self::assertSame(9450, $registration['totalCents']);
        self::assertSame('94.50', $registration['data']['totalPrice']);
    }

    public function testAccommodationCheckoutDateIsDerivedOnTheServer(): void
    {
        $content = [
            'fees' => ['Early Bird' => ['Speaker' => 100]],
            'registrationPeriods' => ['active' => 'Early Bird'],
            'registrationPricing' => ['fixedItems' => []],
            'accommodation' => ['enabled' => true, 'pricePerNight' => '40.25', 'maxNights' => 5],
            'coupons' => [],
        ];
        file_put_contents($this->dataDirectory . '/content.json', json_encode($content, JSON_THROW_ON_ERROR));
        $input = $this->validInput();
        $input['accommodationType'] = 'double';
        $input['accommodationNights'] = '2';
        $input['checkInDate'] = '2027-10-12';

        $registration = $this->service->prepare($input);

        self::assertSame('2027-10-14', $registration['data']['checkOutDate']);
        self::assertSame(18953, $registration['totalCents']);
        self::assertSame(4025, $registration['items'][1]['unitCents']);
    }

    public function testVirtualRegistrationWithoutAccommodationUsesServerPriceAndTax(): void
    {
        $this->saveCheckoutPricing(['addon_accommodation_double' => 435], []);
        $input = $this->virtualInput();

        $registration = $this->service->prepare($input);

        self::assertSame(65400, $registration['grossCents']);
        self::assertSame(0, $registration['discountCents']);
        self::assertSame(3270, $registration['taxCents']);
        self::assertSame(68670, $registration['totalCents']);
        self::assertCount(1, $registration['items']);
    }

    public function testDoubleOccupancyUsesItsSavedNightlyRateAndAppliesPercentDiscountBeforeTax(): void
    {
        $this->saveCheckoutPricing(
            ['addon_accommodation_double' => 435],
            [['code' => 'SAVE12', 'discountType' => 'percentage', 'discountPercentage' => 12, 'enabled' => true]]
        );
        $input = $this->virtualInput();
        $input['accommodationType'] = 'double';
        $input['accommodationNights'] = '1';
        $input['checkInDate'] = '2027-10-12';
        $input['couponCode'] = 'SAVE12';

        $registration = $this->service->prepare($input);

        self::assertSame(108900, $registration['grossCents']);
        self::assertSame(43500, $registration['items'][1]['unitCents']);
        self::assertSame(1, $registration['items'][1]['quantity']);
        self::assertSame(13068, $registration['discountCents']);
        self::assertSame(4792, $registration['taxCents']);
        self::assertSame(100624, $registration['totalCents']);
    }

    public function testAccommodationDurationIsChargedPerNight(): void
    {
        $this->saveCheckoutPricing(['addon_accommodation_double' => 435], []);
        $input = $this->virtualInput();
        $input['accommodationType'] = 'double';
        $input['accommodationNights'] = '2';
        $input['checkInDate'] = '2027-10-12';

        $twoNights = $this->service->prepare($input);
        $input['accommodationNights'] = '3';
        $threeNights = $this->service->prepare($input);

        self::assertSame(2, $twoNights['items'][1]['quantity']);
        self::assertSame(160020, $twoNights['totalCents']);
        self::assertSame(3, $threeNights['items'][1]['quantity']);
        self::assertSame(205695, $threeNights['totalCents']);
    }

    public function testLegacySharedAccommodationPriceIsUsedWhenOccupancyRateIsAbsent(): void
    {
        $this->saveCheckoutPricing([], [], 435);
        $input = $this->virtualInput();
        $input['accommodationType'] = 'double';
        $input['accommodationNights'] = '1';
        $input['checkInDate'] = '2027-10-12';

        $registration = $this->service->prepare($input);

        self::assertSame(43500, $registration['items'][1]['unitCents']);
        self::assertSame(114345, $registration['totalCents']);
    }

    public function testInvalidCalendarDateIsRejected(): void
    {
        $content = [
            'fees' => ['Early Bird' => ['Speaker' => 100]],
            'registrationPeriods' => ['active' => 'Early Bird'],
            'registrationPricing' => ['fixedItems' => []],
            'accommodation' => ['enabled' => true, 'pricePerNight' => '40.25', 'maxNights' => 5],
            'coupons' => [],
        ];
        file_put_contents($this->dataDirectory . '/content.json', json_encode($content, JSON_THROW_ON_ERROR));
        $input = $this->validInput();
        $input['accommodationType'] = 'single';
        $input['accommodationNights'] = '1';
        $input['checkInDate'] = '2027-02-30';

        $this->expectException(DomainException::class);
        $this->service->prepare($input);
    }

    public function testCategoryDeadlineAdvancesOnlyThatCategory(): void
    {
        $today = new \DateTimeImmutable('today', new \DateTimeZone('UTC'));
        $content = [
            'fees' => [
                'Early Bird' => ['Speaker' => 100, 'Delegate' => 200],
                'Mid-Term' => ['Speaker' => 150, 'Delegate' => 250],
            ],
            'registrationPeriods' => [
                'active' => 'Early Bird',
                'Early Bird' => [
                    'deadline' => 'To Be Announced',
                    'categoryDeadlines' => ['Speaker' => $today->modify('-1 day')->format('Y-m-d')],
                ],
                'Mid-Term' => [
                    'deadline' => 'To Be Announced',
                    'categoryDeadlines' => ['Speaker' => $today->modify('+1 day')->format('Y-m-d')],
                ],
            ],
            'registrationPricing' => ['fixedItems' => []],
            'coupons' => [],
        ];
        file_put_contents($this->dataDirectory . '/content.json', json_encode($content, JSON_THROW_ON_ERROR));

        $speaker = $this->service->prepare($this->validInput());
        $delegateInput = $this->validInput();
        $delegateInput['qty_speaker'] = '0';
        $delegateInput['qty_delegate'] = '1';
        $delegate = $this->service->prepare($delegateInput);

        self::assertSame('Mid-Term', $speaker['period']);
        self::assertSame(15750, $speaker['totalCents']);
        self::assertSame('Early Bird', $delegate['period']);
        self::assertSame(21000, $delegate['totalCents']);
    }

    public function testInvalidEmailIsRejected(): void
    {
        $input = $this->validInput();
        $input['email'] = 'invalid';

        $this->expectException(DomainException::class);
        $this->service->prepare($input);
    }

    public function testUnsupportedTransactionCurrencyIsRejected(): void
    {
        $input = $this->validInput();
        $input['currency'] = 'INR';
        $input['originalSelectedCurrency'] = 'USD';

        $this->expectException(DomainException::class);
        $this->service->prepare($input);
    }

    public function testCurrencyFallbackRequiresExplicitConfirmation(): void
    {
        $input = $this->validInput();
        $input['originalSelectedCurrency'] = 'EUR';

        $this->expectException(DomainException::class);
        $this->service->prepare($input);
    }

    public function testConfirmedFallbackKeepsPreferredCurrencyForAudit(): void
    {
        $input = $this->validInput();
        $input['originalSelectedCurrency'] = 'EUR';
        $input['currencyFallbackConfirmed'] = 'true';

        $registration = $this->service->prepare($input);

        self::assertSame(10500, $registration['totalCents']);
        self::assertSame('EUR', $registration['preferredCurrency']);
        self::assertSame('USD', $registration['transactionCurrency']);
        self::assertSame('USD', $registration['data']['currency']);
        self::assertTrue($registration['data']['currencyFallbackConfirmed']);
    }

    private function validInput(): array
    {
        return [
            'fullName' => 'Test Participant',
            'email' => 'participant@example.test',
            'period' => 'Early Bird',
            'institution' => 'Test Institute',
            'country' => 'Germany',
            'terms' => true,
            'privacy' => true,
            'paymentGateway' => 'Bank Transfer',
            'currency' => 'USD',
            'originalSelectedCurrency' => 'USD',
            'currencyFallbackConfirmed' => 'false',
            'qty_speaker' => '1',
        ];
    }

    private function virtualInput(): array
    {
        $input = $this->validInput();
        $input['qty_speaker'] = '0';
        $input['qty_virtual'] = '1';
        return $input;
    }

    private function saveCheckoutPricing(array $fixedItems, array $coupons, int|float|string $legacyNightlyPrice = 999): void
    {
        $content = [
            'fees' => ['Early Bird' => ['Virtual' => 654]],
            'registrationPeriods' => ['active' => 'Early Bird'],
            'registrationPricing' => ['fixedItems' => $fixedItems],
            'accommodation' => [
                'enabled' => true,
                'pricePerNight' => $legacyNightlyPrice,
                'maxNights' => 5,
            ],
            'coupons' => $coupons,
        ];
        file_put_contents($this->dataDirectory . '/content.json', json_encode($content, JSON_THROW_ON_ERROR));
    }
}
