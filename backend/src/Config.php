<?php

declare(strict_types=1);

namespace MatAi;

use Dotenv\Dotenv;

final class Config
{
    private function __construct(private readonly array $values)
    {
    }

    public static function load(string $root): self
    {
        if (is_file($root . '/.env') && class_exists(Dotenv::class)) {
            Dotenv::createImmutable($root)->safeLoad();
        }

        $keys = [
            'APP_ENV', 'APP_URL', 'LOG_LEVEL',
            'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD',
            'ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH',
            'SMTP_HOST', 'SMTP_PORT', 'SMTP_ENCRYPTION', 'SMTP_USERNAME', 'SMTP_PASSWORD', 'SMTP_FROM_ADDRESS',
            'SMTP_FROM_NAME', 'ADMIN_NOTIFICATION_EMAIL',
            'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
            'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MODE',
            'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET',
            'RAZORPAY_CURRENCY'
        ];
        $values = [];
        foreach ($keys as $key) {
            $values[$key] = $_ENV[$key] ?? getenv($key) ?: '';
        }
        $values['APP_ENV'] = $values['APP_ENV'] ?: 'production';
        $values['LOG_LEVEL'] = strtolower($values['LOG_LEVEL'] ?: 'warning');
        $values['MYSQL_PORT'] = $values['MYSQL_PORT'] ?: '3306';
        $values['SMTP_PORT'] = $values['SMTP_PORT'] ?: '587';
        $values['SMTP_ENCRYPTION'] = strtolower($values['SMTP_ENCRYPTION'] ?: 'tls');
        $values['PAYPAL_MODE'] = $values['PAYPAL_MODE'] ?: 'sandbox';
        $values['RAZORPAY_CURRENCY'] = $values['RAZORPAY_CURRENCY'] ?: 'EUR';
        if (!ctype_digit($values['MYSQL_PORT']) || (int) $values['MYSQL_PORT'] < 1 || (int) $values['MYSQL_PORT'] > 65535) {
            throw new \RuntimeException('MYSQL_PORT must be a valid TCP port.');
        }
        $values['APP_URL'] = rtrim($values['APP_URL'], '/');
        return new self($values);
    }

    public function get(string $key, string $default = ''): string
    {
        return (string) ($this->values[$key] ?? $default);
    }

    public function mysqlConfigured(): bool
    {
        return $this->get('MYSQL_HOST') !== ''
            || $this->get('MYSQL_DATABASE') !== ''
            || $this->get('MYSQL_USER') !== ''
            || $this->get('MYSQL_PASSWORD') !== '';
    }
}
