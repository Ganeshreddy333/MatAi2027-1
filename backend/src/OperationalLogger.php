<?php

declare(strict_types=1);

namespace MatAi;

final class OperationalLogger
{
    private static ?string $requestId = null;
    private static int $minimumSeverity = 300;

    public static function configureLevel(string $severity): void
    {
        $value = self::severityValue($severity);
        if ($value === null) {
            throw new \InvalidArgumentException('LOG_LEVEL must be debug, info, notice, warning, error, or critical.');
        }
        self::$minimumSeverity = $value;
    }

    public static function beginRequest(): string
    {
        self::$requestId = bin2hex(random_bytes(16));
        return self::$requestId;
    }

    public static function event(string $severity, string $event, array $context = []): void
    {
        $value = self::severityValue($severity);
        if ($value === null) {
            throw new \InvalidArgumentException('Unknown operational log severity.');
        }
        if ($value < self::$minimumSeverity) {
            return;
        }
        $safeContext = [];
        foreach ($context as $key => $value) {
            if (preg_match('/password|secret|token|authorization|cookie|email|phone|address/i', (string) $key)) {
                continue;
            }
            if (is_string($value) || is_int($value) || is_float($value) || is_bool($value) || $value === null) {
                $safeContext[$key] = $value;
            }
        }

        $entry = [
            'timestamp' => gmdate(DATE_ATOM),
            'severity' => $severity,
            'event' => $event,
            'request_id' => self::$requestId,
            'context' => $safeContext,
        ];
        error_log(json_encode($entry, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE) ?: '{"event":"log_encoding_failed"}');
    }

    private static function severityValue(string $severity): ?int
    {
        return [
            'debug' => 100,
            'info' => 200,
            'notice' => 250,
            'warning' => 300,
            'error' => 400,
            'critical' => 500,
        ][$severity] ?? null;
    }
}
