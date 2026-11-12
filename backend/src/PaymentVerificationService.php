<?php

declare(strict_types=1);

namespace MatAi;

use PDO;
use RuntimeException;
use Throwable;

final class PaymentVerificationService
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function initiate(string $reference, int $amountMinor, string $currency, string $accessToken): void
    {
        if ($amountMinor < 1 || !preg_match('/^[A-Z]{3}$/', $currency) || strlen($accessToken) !== 64) {
            throw new RuntimeException('Invalid payment verification initialization data.');
        }
        $record = $this->registration($reference, false);
        if ($record === null || !$this->financialsMatch($record, $amountMinor, $currency)) {
            throw new RuntimeException('Registration amount failed financial reconciliation.');
        }
        $statement = $this->pdo->prepare(
            'INSERT INTO matai_payment_verifications ' .
            '(registration_reference, amount_minor, currency, access_token_hash, verification_status) ' .
            'VALUES (?, ?, ?, ?, ?)'
        );
        $statement->execute([$reference, $amountMinor, $currency, hash('sha256', $accessToken), 'INITIATED']);
    }

    public function attachOrder(string $reference, string $orderId): void
    {
        $statement = $this->pdo->prepare(
            'UPDATE matai_payment_verifications SET provider_order_id = ? ' .
            'WHERE registration_reference = ? AND provider_order_id IS NULL AND verification_status = ?'
        );
        $statement->execute([$orderId, $reference, 'INITIATED']);
        if ($statement->rowCount() !== 1) {
            throw new RuntimeException('Could not securely associate the Razorpay order with this registration.');
        }
    }

    public function recordVerifiedSignal(
        string $reference,
        string $orderId,
        string $paymentId,
        string $signal,
        array $providerOrder,
        array $providerPayment,
        ?string $accessToken = null,
        ?array $webhookEvent = null
    ): array {
        if (!in_array($signal, ['checkout', 'webhook'], true)) {
            throw new RuntimeException('Unsupported payment verification signal.');
        }
        $this->pdo->beginTransaction();
        try {
            $verification = $this->verification($reference, true);
            $record = $this->registration($reference, true);
            if ($verification === null || $record === null
                || ($verification['provider_order_id'] ?? '') !== $orderId
                || ($record['razorpayOrderId'] ?? '') !== $orderId
                || !$this->financialsMatch($record, (int) $verification['amount_minor'], (string) $verification['currency'])
                || !$this->providerDataMatches($verification, $providerOrder, $providerPayment, $orderId, $paymentId)) {
                throw new RuntimeException('Payment verification or financial reconciliation failed.');
            }
            if ($signal === 'checkout') {
                if ($accessToken === null
                    || !hash_equals((string) $verification['access_token_hash'], hash('sha256', $accessToken))) {
                    throw new RuntimeException('Registration ownership could not be verified.');
                }
            } else {
                if ($webhookEvent === null || ($webhookEvent['id'] ?? '') === '') {
                    throw new RuntimeException('Verified webhook event details are required.');
                }
                $eventInsert = $this->pdo->prepare(
                    'INSERT IGNORE INTO matai_payment_events ' .
                    '(provider, provider_event_id, registration_reference, event_type, payload_json) ' .
                    'VALUES (?, ?, ?, ?, ?)'
                );
                $eventInsert->execute([
                    'razorpay',
                    (string) $webhookEvent['id'],
                    $reference,
                    mb_substr((string) ($webhookEvent['type'] ?? 'payment.captured'), 0, 80),
                    json_encode(['resourceId' => $paymentId], JSON_THROW_ON_ERROR),
                ]);
                if ($eventInsert->rowCount() !== 1) {
                    $this->pdo->commit();
                    return $this->publicStatus($verification);
                }
            }
            if (($verification['verification_status'] ?? '') === 'RECEIPT_GENERATED') {
                $this->pdo->commit();
                return $this->publicStatus($verification);
            }
            $existingPaymentId = (string) ($verification['provider_payment_id'] ?? '');
            $canReplaceFailedAttempt = ($verification['verification_status'] ?? '') === 'FAILED'
                && (int) $verification['checkout_verified'] === 0
                && (int) $verification['webhook_verified'] === 0;
            if ($existingPaymentId !== '' && !hash_equals($existingPaymentId, $paymentId) && !$canReplaceFailedAttempt) {
                throw new RuntimeException('A different Razorpay payment is already associated with this registration.');
            }
            $flags = $signal === 'checkout' ? 'checkout_verified = 1' : 'webhook_verified = 1';
            $paidAtTimestamp = filter_var(
                $providerPayment['captured_at'] ?? $providerPayment['created_at'] ?? null,
                FILTER_VALIDATE_INT
            );
            $paidAt = $paidAtTimestamp === false || $paidAtTimestamp === null
                ? gmdate('Y-m-d H:i:s')
                : gmdate('Y-m-d H:i:s', (int) $paidAtTimestamp);
            $update = $this->pdo->prepare(
                'UPDATE matai_payment_verifications SET provider_payment_id = ?, payment_method = ?, ' . $flags .
                ', razorpay_verified = 1, financial_reconciled = 1, database_validated = 1, ' .
                'verification_status = ?, paid_at = COALESCE(paid_at, ?) ' .
                'WHERE registration_reference = ?'
            );
            $newStatus = $signal === 'checkout' ? 'CALLBACK_VERIFIED' : 'WEBHOOK_VERIFIED';
            $update->execute([$paymentId, (string) ($providerPayment['method'] ?? 'Razorpay'), $newStatus, $paidAt, $reference]);
            $verification = $this->verification($reference, true);
            if ($verification === null) {
                throw new RuntimeException('Payment verification record disappeared.');
            }
            if ((int) $verification['checkout_verified'] === 1 && (int) $verification['webhook_verified'] === 1
                && (int) $verification['razorpay_verified'] === 1
                && (int) $verification['financial_reconciled'] === 1
                && (int) $verification['database_validated'] === 1) {
                $full = $this->pdo->prepare(
                    'UPDATE matai_payment_verifications SET verification_status = ? WHERE registration_reference = ?'
                );
                $full->execute(['FULLY_VERIFIED', $reference]);
                $verification['verification_status'] = 'FULLY_VERIFIED';
                $this->generateReceipt($reference, $verification, $record);
            }
            $this->pdo->commit();
            return $this->statusByReference($reference);
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }
    }

    public function recordWebhookFailure(
        string $reference,
        string $orderId,
        string $paymentId,
        array $event,
        array $providerOrder,
        array $providerPayment
    ): array {
        $this->pdo->beginTransaction();
        try {
            $verification = $this->verification($reference, true);
            if ($verification === null || ($verification['provider_order_id'] ?? '') !== $orderId
                || ($providerPayment['status'] ?? '') !== 'failed'
                || ($providerPayment['order_id'] ?? '') !== $orderId
                || !$this->providerOrderMatches($verification, $providerOrder, $orderId)
                || (string) ($providerPayment['id'] ?? '') !== $paymentId) {
                throw new RuntimeException('Failed payment event does not match the stored order.');
            }
            $insert = $this->pdo->prepare(
                'INSERT IGNORE INTO matai_payment_events ' .
                '(provider, provider_event_id, registration_reference, event_type, payload_json) ' .
                'VALUES (?, ?, ?, ?, ?)'
            );
            $insert->execute([
                'razorpay',
                (string) ($event['id'] ?? ''),
                $reference,
                mb_substr((string) ($event['event'] ?? 'payment.failed'), 0, 80),
                json_encode(['resourceId' => $paymentId], JSON_THROW_ON_ERROR),
            ]);
            $orderAlreadyPaid = ($providerOrder['status'] ?? '') === 'paid'
                && (int) ($providerOrder['amount_paid'] ?? -1) === (int) $verification['amount_minor'];
            if ($insert->rowCount() === 1 && !$orderAlreadyPaid
                && !in_array($verification['verification_status'], ['FULLY_VERIFIED', 'RECEIPT_GENERATED'], true)) {
                $update = $this->pdo->prepare(
                    'UPDATE matai_payment_verifications SET provider_payment_id = ?, verification_status = ? ' .
                    'WHERE registration_reference = ?'
                );
                $update->execute([$paymentId, 'FAILED', $reference]);
                $record = $this->registration($reference, true);
                if ($record !== null && !in_array($record['paymentStatus'] ?? '', ['Paid', 'Failed'], true)) {
                    $record['paymentStatus'] = 'Failed';
                    $record['paymentVerificationStatus'] = 'FAILED';
                    $this->saveRegistration($reference, $record);
                }
            }
            $this->pdo->commit();
            return $this->statusByReference($reference);
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }
    }

    public function status(string $reference, ?string $accessToken = null): array
    {
        $verification = $this->verification($reference, false);
        if ($verification === null || $accessToken === null
            || !hash_equals((string) $verification['access_token_hash'], hash('sha256', $accessToken))) {
            throw new \UnexpectedValueException('Registration was not found or access is unauthorized.');
        }
        return $this->publicStatus($verification);
    }

    public function statusByReference(string $reference): array
    {
        $verification = $this->verification($reference, false);
        return $verification === null
            ? ['verificationStatus' => 'NOT_FOUND', 'receiptReady' => false]
            : $this->publicStatus($verification);
    }

    public function referenceForOrder(string $orderId): ?string
    {
        $statement = $this->pdo->prepare(
            'SELECT registration_reference FROM matai_payment_verifications WHERE provider_order_id = ?'
        );
        $statement->execute([$orderId]);
        $reference = $statement->fetchColumn();
        return is_string($reference) ? $reference : null;
    }

    public function adminDetails(string $reference): array
    {
        $verification = $this->verification($reference, false);
        if ($verification === null) {
            return ['verificationStatus' => 'NOT_FOUND'];
        }
        return [
            'verificationStatus' => (string) $verification['verification_status'],
            'checkoutVerified' => (bool) $verification['checkout_verified'],
            'webhookVerified' => (bool) $verification['webhook_verified'],
            'razorpayVerified' => (bool) $verification['razorpay_verified'],
            'financialReconciled' => (bool) $verification['financial_reconciled'],
            'databaseValidated' => (bool) $verification['database_validated'],
            'orderId' => $verification['provider_order_id'],
            'paymentId' => $verification['provider_payment_id'],
            'paymentMethod' => $verification['payment_method'],
            'amountMinor' => (int) $verification['amount_minor'],
            'currency' => (string) $verification['currency'],
            'receiptNumber' => $verification['receipt_number'],
            'receiptGeneratedAt' => $verification['receipt_generated_at'],
            'paidAt' => $verification['paid_at'],
        ];
    }

    public function receipt(string $reference, ?string $accessToken = null, bool $admin = false): ?array
    {
        $verification = $this->verification($reference, false);
        if ($verification === null || (!$admin && ($accessToken === null
            || !hash_equals((string) $verification['access_token_hash'], hash('sha256', $accessToken))))
            || $verification['verification_status'] !== 'RECEIPT_GENERATED'
            || empty($verification['receipt_pdf'])
            || empty($verification['receipt_number'])) {
            return null;
        }
        return [
            'number' => (string) $verification['receipt_number'],
            'pdf' => (string) $verification['receipt_pdf'],
        ];
    }

    private function generateReceipt(string $reference, array $verification, array $record): void
    {
        if ($verification['verification_status'] === 'RECEIPT_GENERATED') {
            return;
        }
        $data = is_array($record['data'] ?? null) ? $record['data'] : [];
        $snapshot = $record['pricingSnapshot'];
        $number = 'MATAI-' . gmdate('Y') . '-' . strtoupper(bin2hex(random_bytes(6)));
        $receipt = [
            'receiptNumber' => $number,
            'reference' => $reference,
            'currency' => (string) $verification['currency'],
            'amountMinor' => (int) $verification['amount_minor'],
            'paymentMethod' => (string) ($verification['payment_method'] ?: 'Razorpay'),
            'paymentId' => (string) $verification['provider_payment_id'],
            'orderId' => (string) $verification['provider_order_id'],
            'paidAt' => (string) ($verification['paid_at'] ?? gmdate('Y-m-d H:i:s')) . ' UTC',
            'participant' => [
                'name' => (string) ($data['fullName'] ?? ''),
                'email' => (string) ($data['email'] ?? ''),
                'phone' => (string) ($data['phone'] ?? ''),
                'institution' => (string) ($data['institution'] ?? ''),
                'cityCountry' => trim((string) ($data['city'] ?? '') . ', ' . (string) ($data['country'] ?? ''), ', '),
            ],
            'registration' => [
                'category' => (string) ($data['category'] ?? ''),
                'participants' => (int) ($data['participantCount'] ?? 0),
            ],
            'items' => array_map(static function (array $item): array {
                return [
                    'name' => (string) ($item['name'] ?? ''),
                    'quantity' => (int) ($item['quantity'] ?? 0),
                    'unitCents' => (int) ($item['unitCents'] ?? 0),
                    'lineTotalCents' => (int) ($item['lineTotalCents'] ?? ((int) ($item['unitCents'] ?? 0) * (int) ($item['quantity'] ?? 0))),
                ];
            }, $snapshot['items']),
            'accommodation' => [
                'type' => (string) ($data['accommodationType'] ?? ''),
                'nights' => (int) ($data['accommodationNights'] ?? 0),
                'checkInDate' => (string) ($data['checkInDate'] ?? ''),
                'checkOutDate' => (string) ($data['checkOutDate'] ?? ''),
            ],
            'pricing' => [
                'grossCents' => (int) $snapshot['grossCents'],
                'couponCode' => (string) ($data['couponCode'] ?? ''),
                'discountCents' => (int) $snapshot['discountCents'],
                'taxCents' => (int) $snapshot['taxCents'],
                'taxRateBasisPoints' => RegistrationService::TAX_RATE_BASIS_POINTS,
            ],
        ];
        $pdf = ReceiptPdf::render($receipt);
        $update = $this->pdo->prepare(
            'UPDATE matai_payment_verifications SET verification_status = ?, receipt_number = ?, ' .
            'receipt_generated_at = UTC_TIMESTAMP(), receipt_json = ?, receipt_pdf = ? ' .
            'WHERE registration_reference = ? AND verification_status <> ?'
        );
        $update->execute([
            'RECEIPT_GENERATED',
            $number,
            json_encode($receipt, JSON_THROW_ON_ERROR),
            $pdf,
            $reference,
            'RECEIPT_GENERATED',
        ]);
        if ($update->rowCount() !== 1) {
            throw new RuntimeException('Receipt generation was not committed.');
        }
        $record['paymentStatus'] = 'Paid';
        $record['paymentVerificationStatus'] = 'RECEIPT_GENERATED';
        $record['razorpayPaymentId'] = (string) $verification['provider_payment_id'];
        $record['razorpayOrderId'] = (string) $verification['provider_order_id'];
        $record['receiptNumber'] = $number;
        $record['amountPaidMinor'] = (int) $verification['amount_minor'];
        $record['paidAt'] = gmdate(DATE_ATOM);
        $this->saveRegistration($reference, $record);
    }

    private function financialsMatch(array $record, int $amountMinor, string $currency): bool
    {
        $snapshot = $record['pricingSnapshot'] ?? null;
        if (!is_array($snapshot) || !is_array($snapshot['items'] ?? null)
            || (int) ($snapshot['totalCents'] ?? -1) !== $amountMinor
            || strtoupper((string) ($snapshot['currency'] ?? '')) !== $currency
            || strtoupper((string) ($record['transactionCurrency'] ?? $record['amountCurrency'] ?? '')) !== $currency) {
            return false;
        }
        $itemsTotal = 0;
        foreach ($snapshot['items'] as $item) {
            if (!is_array($item) || (int) ($item['quantity'] ?? 0) < 1 || (int) ($item['unitCents'] ?? -1) < 0) {
                return false;
            }
            $line = (int) $item['unitCents'] * (int) $item['quantity'];
            if (isset($item['lineTotalCents']) && (int) $item['lineTotalCents'] !== $line) {
                return false;
            }
            $itemsTotal += $line;
        }
        $gross = (int) ($snapshot['grossCents'] ?? -1);
        $discount = (int) ($snapshot['discountCents'] ?? -1);
        $tax = (int) ($snapshot['taxCents'] ?? -1);
        $taxable = $gross - $discount;
        if ($gross < 0 || $discount < 0 || $discount > $gross || $taxable < 0) {
            return false;
        }
        $expectedTax = intdiv($taxable * RegistrationService::TAX_RATE_BASIS_POINTS + 5000, 10000);
        return $itemsTotal === $gross
            && $tax === $expectedTax && $taxable + $tax === $amountMinor
            && CurrencyPolicy::paymentMatches($record['amount'] ?? null, $currency, CurrencyPolicy::formatMinorUnits($amountMinor), $currency);
    }

    private function providerDataMatches(
        array $verification,
        array $order,
        array $payment,
        string $orderId,
        string $paymentId
    ): bool {
        return ($payment['status'] ?? '') === 'captured'
            && (string) ($payment['id'] ?? '') === $paymentId
            && (string) ($payment['order_id'] ?? '') === $orderId
            && (string) ($order['status'] ?? '') === 'paid'
            && (int) ($order['amount_paid'] ?? -1) === (int) $verification['amount_minor']
            && $this->providerOrderMatches($verification, $order, $orderId)
            && CurrencyPolicy::paymentMatchesMinorUnits(
                (int) $verification['amount_minor'],
                (string) $verification['currency'],
                $payment['amount'] ?? null,
                (string) ($payment['currency'] ?? '')
            );
    }

    private function providerOrderMatches(array $verification, array $order, string $orderId): bool
    {
        return (string) ($order['id'] ?? '') === $orderId
            && CurrencyPolicy::paymentMatchesMinorUnits(
                (int) $verification['amount_minor'],
                (string) $verification['currency'],
                $order['amount'] ?? null,
                (string) ($order['currency'] ?? '')
            );
    }

    private function publicStatus(array $verification): array
    {
        $state = (string) ($verification['verification_status'] ?? 'INITIATED');
        return [
            'verificationStatus' => $state,
            'paid' => $state === 'RECEIPT_GENERATED',
            'receiptReady' => $state === 'RECEIPT_GENERATED' && !empty($verification['receipt_pdf']),
            'receiptNumber' => $state === 'RECEIPT_GENERATED' ? ($verification['receipt_number'] ?? null) : null,
            'amountMinor' => (int) $verification['amount_minor'],
            'currency' => (string) $verification['currency'],
        ];
    }

    private function verification(string $reference, bool $lock): ?array
    {
        $statement = $this->pdo->prepare(
            'SELECT * FROM matai_payment_verifications WHERE registration_reference = ?' .
            ($lock ? ' FOR UPDATE' : '')
        );
        $statement->execute([$reference]);
        $row = $statement->fetch();
        return is_array($row) ? $row : null;
    }

    private function registration(string $reference, bool $lock): ?array
    {
        $statement = $this->pdo->prepare(
            'SELECT record_json FROM matai_submissions WHERE kind = ? AND reference = ?' .
            ($lock ? ' FOR UPDATE' : '')
        );
        $statement->execute(['register', $reference]);
        $value = $statement->fetchColumn();
        if (!is_string($value)) {
            return null;
        }
        $record = json_decode($value, true, 512, JSON_THROW_ON_ERROR);
        return is_array($record) ? $record : null;
    }

    private function saveRegistration(string $reference, array $record): void
    {
        $statement = $this->pdo->prepare(
            'UPDATE matai_submissions SET payment_status = ?, record_json = ? ' .
            'WHERE kind = ? AND reference = ?'
        );
        $statement->execute([
            $record['paymentStatus'] ?? 'Pending',
            json_encode($record, JSON_THROW_ON_ERROR),
            'register',
            $reference,
        ]);
        if ($statement->rowCount() !== 1) {
            throw new RuntimeException('Verified payment could not be committed to its registration.');
        }
    }
}
