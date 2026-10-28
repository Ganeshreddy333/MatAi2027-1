<?php

declare(strict_types=1);

namespace MatAi;

use DomainException;

final class CurrencyPolicy
{
    public const BASE_CURRENCY = 'EUR';
    private const SELECTABLE_CURRENCIES = ['EUR', 'USD', 'GBP'];

    public static function selection(array $input): array
    {
        $transactionCurrency = strtoupper(trim((string) ($input['currency'] ?? '')));
        $preferredCurrency = strtoupper(trim((string) ($input['originalSelectedCurrency'] ?? '')));
        $fallbackConfirmed = in_array($input['currencyFallbackConfirmed'] ?? null, [true, 'true', '1', 'on', 1], true);

        if ($transactionCurrency !== self::BASE_CURRENCY) {
            throw new DomainException('The selected currency is not available for checkout. Confirm the EUR fallback or choose EUR.');
        }
        if (!in_array($preferredCurrency, self::SELECTABLE_CURRENCIES, true)) {
            throw new DomainException('Select a valid preferred currency.');
        }
        if ($preferredCurrency !== $transactionCurrency && !$fallbackConfirmed) {
            throw new DomainException('Confirm the currency change before continuing to checkout.');
        }
        if ($preferredCurrency === $transactionCurrency && $fallbackConfirmed) {
            throw new DomainException('The currency fallback confirmation is not applicable to the selected currency.');
        }

        return [
            'preferredCurrency' => $preferredCurrency,
            'transactionCurrency' => $transactionCurrency,
            'currencyFallbackConfirmed' => $fallbackConfirmed,
        ];
    }

    public static function paymentMatches(
        mixed $expectedAmount,
        mixed $expectedCurrency,
        mixed $actualAmount,
        mixed $actualCurrency
    ): bool {
        if (!is_numeric($expectedAmount) || !is_numeric($actualAmount)
            || !is_string($expectedCurrency) || !is_string($actualCurrency)
            || strtoupper($expectedCurrency) !== strtoupper($actualCurrency)) {
            return false;
        }
        $expectedCents = round((float) $expectedAmount * 100);
        $actualCents = round((float) $actualAmount * 100);
        return $expectedCents >= 0 && $actualCents >= 0 && $expectedCents === $actualCents;
    }
}
