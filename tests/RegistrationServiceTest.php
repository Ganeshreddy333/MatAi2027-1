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
}
