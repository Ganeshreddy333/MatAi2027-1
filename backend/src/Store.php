<?php

declare(strict_types=1);

namespace MatAi;

use PDO;
use RuntimeException;

final class Store
{
    public function __construct(
        private readonly ?PDO $pdo,
        private readonly string $dataDirectory
    ) {
    }

    public function submissions(string $kind): array
    {
        $this->assertKind($kind);
        if ($this->pdo !== null) {
            $query = $this->pdo->prepare(
                'SELECT record_json FROM matai_submissions WHERE kind = ? ORDER BY received_at, reference'
            );
            $query->execute([$kind]);
            return array_map(
                static fn (array $row): array => json_decode((string) $row['record_json'], true, 512, JSON_THROW_ON_ERROR),
                $query->fetchAll()
            );
        }
        $path = $this->dataDirectory . '/' . $kind . '.json';
        if (!is_file($path)) {
            return [];
        }
        $records = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($records)) {
            throw new RuntimeException('Submission store is not an array: ' . $kind);
        }
        return $records;
    }

    public function saveSubmissions(string $kind, array $records): void
    {
        $this->assertKind($kind);
        if ($this->pdo === null) {
            $this->atomicWrite($this->dataDirectory . '/' . $kind . '.json', $records);
            return;
        }
        $this->pdo->beginTransaction();
        try {
            $lock = $this->pdo->prepare('INSERT IGNORE INTO matai_submission_locks (kind) VALUES (?)');
            $lock->execute([$kind]);
            $lock = $this->pdo->prepare('SELECT kind FROM matai_submission_locks WHERE kind = ? FOR UPDATE');
            $lock->execute([$kind]);
            $this->persistSubmissions($kind, $records);
            $this->pdo->commit();
        } catch (\Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }
    }

    public function content(): array
    {
        if ($this->pdo !== null) {
            $query = $this->pdo->prepare('SELECT content_json FROM matai_site_content WHERE content_key = ?');
            $query->execute(['site']);
            $value = $query->fetchColumn();
            if ($value === false) {
                throw new RuntimeException('Website content is not initialized; run database migrations.');
            }
            $content = json_decode((string) $value, true, 512, JSON_THROW_ON_ERROR);
            return is_array($content) ? $content : [];
        }
        $path = $this->dataDirectory . '/content.json';
        if (!is_file($path)) {
            throw new RuntimeException('Website content file is missing.');
        }
        $content = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
        return is_array($content) ? $content : [];
    }

    public function saveContent(array $content): void
    {
        if ($this->pdo !== null) {
            $query = $this->pdo->prepare(
                'INSERT INTO matai_site_content (content_key, content_json) VALUES (?, ?) ' .
                'ON DUPLICATE KEY UPDATE content_json = VALUES(content_json)'
            );
            $query->execute(['site', json_encode($content, JSON_THROW_ON_ERROR)]);
            return;
        }
        $this->atomicWrite($this->dataDirectory . '/content.json', $content);
    }

    public function mutate(string $kind, callable $callback): mixed
    {
        $this->assertKind($kind);
        if ($this->pdo === null) {
            if (!is_dir($this->dataDirectory) && !mkdir($this->dataDirectory, 0700, true) && !is_dir($this->dataDirectory)) {
                throw new RuntimeException('Could not create the private data directory.');
            }
            $path = $this->dataDirectory . '/' . $kind . '.json';
            $handle = fopen($path, 'c+');
            if ($handle === false) {
                throw new RuntimeException('Could not open the submission store.');
            }
            try {
                if (!flock($handle, LOCK_EX)) {
                    throw new RuntimeException('Could not lock the submission store.');
                }
                $raw = stream_get_contents($handle);
                $records = $raw === '' ? [] : json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
                if (!is_array($records)) {
                    throw new RuntimeException('Submission store is not an array: ' . $kind);
                }
                $result = $callback($records);
                ftruncate($handle, 0);
                rewind($handle);
                fwrite($handle, json_encode($records, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
                fflush($handle);
                chmod($path, 0600);
                return $result;
            } finally {
                flock($handle, LOCK_UN);
                fclose($handle);
            }
        }
        $this->pdo->beginTransaction();
        try {
            $lock = $this->pdo->prepare('INSERT IGNORE INTO matai_submission_locks (kind) VALUES (?)');
            $lock->execute([$kind]);
            $lock = $this->pdo->prepare('SELECT kind FROM matai_submission_locks WHERE kind = ? FOR UPDATE');
            $lock->execute([$kind]);
            $query = $this->pdo->prepare(
                'SELECT reference, record_json FROM matai_submissions WHERE kind = ? FOR UPDATE'
            );
            $query->execute([$kind]);
            $rows = $query->fetchAll();
            $records = array_map(
                static fn (array $row): array => json_decode((string) $row['record_json'], true, 512, JSON_THROW_ON_ERROR),
                $rows
            );
            $result = $callback($records);
            $this->persistSubmissions($kind, $records, array_column($rows, 'reference'));
            $this->pdo->commit();
            return $result;
        } catch (\Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }
    }

    private function assertKind(string $kind): void
    {
        if (!in_array($kind, ['register', 'abstract', 'contact', 'brochure'], true)) {
            throw new RuntimeException('Unknown submission type.');
        }
    }

    private function atomicWrite(string $path, array $value): void
    {
        if (!is_dir($this->dataDirectory) && !mkdir($this->dataDirectory, 0700, true) && !is_dir($this->dataDirectory)) {
            throw new RuntimeException('Could not create the private data directory.');
        }
        $tmp = $path . '.' . bin2hex(random_bytes(8)) . '.tmp';
        $encoded = json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        if (file_put_contents($tmp, $encoded, LOCK_EX) === false || !rename($tmp, $path)) {
            if (is_file($tmp)) {
                unlink($tmp);
            }
            throw new RuntimeException('Could not save application data.');
        }
        chmod($path, 0600);
    }

    private function persistSubmissions(string $kind, array $records, ?array $existingReferences = null): void
    {
        if ($existingReferences === null) {
            $existing = $this->pdo->prepare('SELECT reference FROM matai_submissions WHERE kind = ? FOR UPDATE');
            $existing->execute([$kind]);
            $existingReferences = array_column($existing->fetchAll(), 'reference');
        }
        $retained = [];
        foreach ($records as $record) {
            if (is_array($record) && isset($record['reference'])) {
                $retained[(string) $record['reference']] = true;
            }
        }
        $delete = $this->pdo->prepare('DELETE FROM matai_submissions WHERE kind = ? AND reference = ?');
        foreach ($existingReferences as $reference) {
            if (!isset($retained[(string) $reference])) {
                $delete->execute([$kind, $reference]);
            }
        }
        $insert = $this->pdo->prepare(
            'INSERT INTO matai_submissions ' .
            '(kind, reference, received_at, status, payment_status, amount, record_json) ' .
            'VALUES (?, ?, ?, ?, ?, ?, ?) ' .
            'ON DUPLICATE KEY UPDATE received_at = VALUES(received_at), status = VALUES(status), ' .
            'payment_status = VALUES(payment_status), amount = VALUES(amount), record_json = VALUES(record_json)'
        );
        foreach ($records as $record) {
            if (!is_array($record) || empty($record['reference'])) {
                throw new RuntimeException('Submission record is missing its reference.');
            }
            $insert->execute([
                $kind,
                substr((string) $record['reference'], 0, 80),
                substr((string) ($record['receivedAt'] ?? gmdate(DATE_ATOM)), 0, 40),
                $record['status'] ?? null,
                $record['paymentStatus'] ?? null,
                isset($record['amount']) ? (float) $record['amount'] : null,
                json_encode($record, JSON_THROW_ON_ERROR),
            ]);
        }
    }
}
