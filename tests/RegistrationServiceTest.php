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

    public function testInvalidEmailIsRejected(): void
    {
        $input = $this->validInput();
        $input['email'] = 'invalid';

        $this->expectException(DomainException::class);
        $this->service->prepare($input);
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
            'paymentGateway' => 'Bank Transfer',
            'qty_speaker' => '1',
        ];
    }
}
