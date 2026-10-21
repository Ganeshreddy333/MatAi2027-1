<?php

declare(strict_types=1);

namespace MatAi;

use PDO;
use RuntimeException;

final class Security
{
    public function __construct(
        private readonly Config $config,
        private readonly ?PDO $pdo
    ) {
    }

    public function startSession(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        ini_set('session.use_trans_sid', '0');
        $secure = $this->isHttps() || str_starts_with($this->config->get('APP_URL'), 'https://');
        session_name('matai_admin');
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'secure' => $secure,
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
        if (!session_start()) {
            throw new RuntimeException('Could not initialize the secure session.');
        }
        if (empty($_SESSION['csrf'])) {
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
        }
    }

    public function csrfToken(): string
    {
        $this->startSession();
        return (string) $_SESSION['csrf'];
    }

    public function verifyCsrf(): void
    {
        $this->startSession();
        $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!is_string($token) || !hash_equals((string) $_SESSION['csrf'], $token)) {
            OperationalLogger::event('warning', 'csrf_validation_failed');
            self::json(['ok' => false, 'error' => 'The request security token is invalid or expired.'], 419);
        }
    }

    public function enforceRateLimit(string $bucket, int $limit, int $windowSeconds): void
    {
        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
        $key = hash('sha256', $bucket . "\0" . $ip);
        if ($this->pdo !== null) {
            $query = $this->pdo->prepare(
                'INSERT INTO matai_api_rate_limits (rate_key, attempts, window_started_at) VALUES (?, 1, CURRENT_TIMESTAMP) ' .
                'ON DUPLICATE KEY UPDATE attempts = IF(window_started_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ' .
                (int) $windowSeconds . ' SECOND), 1, attempts + 1), ' .
                'window_started_at = IF(window_started_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ' .
                (int) $windowSeconds . ' SECOND), CURRENT_TIMESTAMP, window_started_at)'
            );
            $query->execute([$key]);
            $read = $this->pdo->prepare('SELECT attempts, window_started_at FROM matai_api_rate_limits WHERE rate_key = ?');
            $read->execute([$key]);
            $row = $read->fetch();
            $limited = is_array($row)
                && strtotime((string) $row['window_started_at']) > time() - $windowSeconds
                && (int) $row['attempts'] > $limit;
        } else {
            $file = dirname(__DIR__) . '/data/api-rate-limits.json';
            $handle = fopen($file, 'c+');
            if ($handle === false) {
                throw new RuntimeException('Could not apply request rate limits.');
            }
            try {
                if (!flock($handle, LOCK_EX)) {
                    throw new RuntimeException('Could not lock request rate-limit data.');
                }
                $attempts = json_decode((string) stream_get_contents($handle), true);
                $attempts = is_array($attempts) ? $attempts : [];
                $record = $attempts['rate:' . $key] ?? ['count' => 0, 'started' => time()];
                if ((int) $record['started'] <= time() - $windowSeconds) {
                    $record = ['count' => 0, 'started' => time()];
                }
                $record['count'] = (int) $record['count'] + 1;
                $attempts['rate:' . $key] = $record;
                ftruncate($handle, 0);
                rewind($handle);
                fwrite($handle, json_encode($attempts));
                fflush($handle);
                $limited = $record['count'] > $limit;
            } finally {
                flock($handle, LOCK_UN);
                fclose($handle);
            }
            chmod($file, 0600);
        }
        if ($limited) {
            OperationalLogger::event('warning', 'request_rate_limited', ['bucket' => $bucket]);
            self::json(['ok' => false, 'error' => 'Too many requests. Please wait before trying again.'], 429);
        }
    }

    public function isAuthenticated(): bool
    {
        $this->startSession();
        return isset($_SESSION['admin_user'], $_SESSION['last_activity'])
            && time() - (int) $_SESSION['last_activity'] <= 28800
            && $this->touchSession();
    }

    public function requireAdmin(): void
    {
        if (!$this->isAuthenticated()) {
            self::json(['ok' => false, 'error' => 'Unauthorized'], 401);
        }
    }

    public function login(string $username, string $password): bool
    {
        $configuredUser = $this->config->get('ADMIN_USERNAME');
        $passwordHash = $this->config->get('ADMIN_PASSWORD_HASH');
        if ($configuredUser === '' || !str_starts_with($passwordHash, '$')) {
            throw new RuntimeException('Set ADMIN_USERNAME and ADMIN_PASSWORD_HASH in the private environment configuration.');
        }
        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
        $key = hash('sha256', $ip . "\0" . strtolower($username));
        if ($this->isRateLimited($key)) {
            OperationalLogger::event('warning', 'admin_login_throttled', ['subject_hash' => substr($key, 0, 12)]);
            return false;
        }
        $valid = hash_equals($configuredUser, $username) && password_verify($password, $passwordHash);
        if (!$valid) {
            $this->recordFailedLogin($key);
            OperationalLogger::event('warning', 'admin_login_failed', ['subject_hash' => substr($key, 0, 12)]);
            return false;
        }
        $this->clearLoginFailures($key);
        $this->startSession();
        if (!session_regenerate_id(true)) {
            throw new RuntimeException('Could not rotate the session identifier.');
        }
        $_SESSION = [
            'admin_user' => $configuredUser,
            'last_activity' => time(),
            'csrf' => bin2hex(random_bytes(32)),
        ];
        return true;
    }

    public function logout(): void
    {
        $this->startSession();
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', [
                'expires' => time() - 42000,
                'path' => $params['path'],
                'domain' => $params['domain'],
                'secure' => (bool) $params['secure'],
                'httponly' => (bool) $params['httponly'],
                'samesite' => 'Strict',
            ]);
        }
        session_destroy();
    }

    public static function json(array $payload, int $status = 200): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
        exit;
    }

    private function isHttps(): bool
    {
        return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (isset($_SERVER['SERVER_PORT']) && (int) $_SERVER['SERVER_PORT'] === 443);
    }

    private function touchSession(): bool
    {
        $_SESSION['last_activity'] = time();
        return true;
    }

    private function isRateLimited(string $key): bool
    {
        if ($this->pdo === null) {
            $file = dirname(__DIR__) . '/data/login-attempts.json';
            $attempts = is_file($file) ? json_decode((string) file_get_contents($file), true) : [];
            $record = is_array($attempts) ? ($attempts[$key] ?? null) : null;
            return is_array($record)
                && (int) ($record['started'] ?? 0) > time() - 900
                && (int) ($record['count'] ?? 0) >= 5;
        }
        $query = $this->pdo->prepare('SELECT attempts, window_started_at FROM matai_login_attempts WHERE attempt_key = ?');
        $query->execute([$key]);
        $row = $query->fetch();
        return is_array($row)
            && strtotime((string) $row['window_started_at']) > time() - 900
            && (int) $row['attempts'] >= 5;
    }

    private function recordFailedLogin(string $key): void
    {
        if ($this->pdo === null) {
            $file = dirname(__DIR__) . '/data/login-attempts.json';
            $attempts = [];
            if (is_file($file)) {
                $decoded = json_decode((string) file_get_contents($file), true);
                $attempts = is_array($decoded) ? $decoded : [];
            }
            $record = $attempts[$key] ?? ['count' => 0, 'started' => time()];
            if ((int) $record['started'] <= time() - 900) {
                $record = ['count' => 0, 'started' => time()];
            }
            $record['count'] = (int) $record['count'] + 1;
            $attempts[$key] = $record;
            if (file_put_contents($file, json_encode($attempts), LOCK_EX) === false) {
                throw new RuntimeException('Could not record a failed administrator login attempt.');
            }
            chmod($file, 0600);
            return;
        }
        $query = $this->pdo->prepare(
            'INSERT INTO matai_login_attempts (attempt_key, attempts, window_started_at) VALUES (?, 1, CURRENT_TIMESTAMP) ' .
            'ON DUPLICATE KEY UPDATE attempts = IF(window_started_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 MINUTE), 1, attempts + 1), ' .
            'window_started_at = IF(window_started_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 MINUTE), CURRENT_TIMESTAMP, window_started_at)'
        );
        $query->execute([$key]);
    }

    private function clearLoginFailures(string $key): void
    {
        if ($this->pdo === null) {
            $file = dirname(__DIR__) . '/data/login-attempts.json';
            if (!is_file($file)) {
                return;
            }
            $handle = fopen($file, 'c+');
            if ($handle === false) {
                throw new RuntimeException('Could not update administrator login rate limits.');
            }
            try {
                flock($handle, LOCK_EX);
                $attempts = json_decode((string) stream_get_contents($handle), true);
                if (is_array($attempts)) {
                    unset($attempts[$key]);
                    ftruncate($handle, 0);
                    rewind($handle);
                    fwrite($handle, json_encode($attempts));
                }
            } finally {
                flock($handle, LOCK_UN);
                fclose($handle);
            }
            return;
        }
        $query = $this->pdo->prepare('DELETE FROM matai_login_attempts WHERE attempt_key = ?');
        $query->execute([$key]);
    }
}
