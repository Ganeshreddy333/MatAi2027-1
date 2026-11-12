<?php

declare(strict_types=1);

namespace MatAi;

use DomainException;

final class CurrencyPolicy
{
    /** Merchant settlement currency; application amounts are never converted. */
    public const BASE_CURRENCY = 'USD';
    private const SELECTABLE_CURRENCIES = ['USD', 'EUR', 'GBP'];

    public static function selection(array $input): array
    {
        $transactionCurrency = strtoupper(trim((string) ($input['currency'] ?? '')));
        $preferredCurrency = strtoupper(trim((string) ($input['originalSelectedCurrency'] ?? '')));
        $fallbackConfirmed = in_array($input['currencyFallbackConfirmed'] ?? null, [true, 'true', '1', 'on', 1], true);

        if ($transactionCurrency !== self::BASE_CURRENCY) {
            throw new DomainException('The selected currency is not available for checkout. Confirm the USD fallback or choose USD.');
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
        if (!is_string($expectedCurrency) || !is_string($actualCurrency)
            || strtoupper(trim($expectedCurrency)) !== strtoupper(trim($actualCurrency))) {
            return false;
        }
        $expectedCents = self::minorUnits($expectedAmount);
        $actualCents = self::minorUnits($actualAmount);
        return $expectedCents !== null && $actualCents !== null && $expectedCents === $actualCents;
    }

    public static function paymentMatchesMinorUnits(
        mixed $expectedMinorUnits,
        mixed $expectedCurrency,
        mixed $actualMinorUnits,
        mixed $actualCurrency
    ): bool {
        if (!is_string($expectedCurrency) || !is_string($actualCurrency)
            || strtoupper(trim($expectedCurrency)) !== strtoupper(trim($actualCurrency))
            || !is_int($expectedMinorUnits) || $expectedMinorUnits < 0
            || !is_int($actualMinorUnits) || $actualMinorUnits < 0) {
            return false;
        }
        return $expectedMinorUnits === $actualMinorUnits;
    }

    public static function toMinorUnits(mixed $amount): ?int
    {
        return self::minorUnits($amount);
    }

    public static function formatMinorUnits(int $minorUnits): string
    {
        if ($minorUnits < 0) {
            throw new DomainException('Minor units cannot be negative.');
        }
        return intdiv($minorUnits, 100) . '.' . str_pad((string) ($minorUnits % 100), 2, '0', STR_PAD_LEFT);
    }

    private static function minorUnits(mixed $amount): ?int
    {
        if (!is_string($amount) && !is_int($amount) && !is_float($amount)) {
            return null;
        }
        $value = trim((string) $amount);
        if (!preg_match('/^(\d{1,10})(?:\.(\d{1,2}))?$/', $value, $matches)) {
            return null;
        }
        return ((int) $matches[1] * 100) + (int) str_pad($matches[2] ?? '', 2, '0');
    }
}
