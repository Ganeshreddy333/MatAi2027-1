<?php

declare(strict_types=1);

namespace MatAi;

use DomainException;
use PDO;
use RuntimeException;
use Throwable;

final class Application
{
    private const ABSTRACT_GUIDELINES_VERSION = 'abstracts-page-2027-10-31';
    private readonly Store $store;
    private readonly Security $security;
    private readonly RegistrationService $registrations;
    private readonly NotificationService $notifications;
    private readonly ?PDO $pdo;
    private readonly string $root;
    private readonly string $uploadDirectory;

    public function __construct(private readonly Config $config)
    {
        OperationalLogger::configureLevel($config->get('LOG_LEVEL', 'warning'));
        $this->root = dirname(__DIR__, 2);
        $this->uploadDirectory = $this->root . '/backend/data/uploads';
        $database = new Database($config);
        $this->pdo = $database->connect();
        $this->store = new Store($this->pdo, $this->root . '/backend/data');
        $this->security = new Security($config, $this->pdo);
        $this->registrations = new RegistrationService($this->store);
        $this->notifications = new NotificationService($config);
    }

    public function run(): never
    {
        $requestId = OperationalLogger::beginRequest();
        header('X-Request-ID: ' . $requestId);
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: strict-origin-when-cross-origin');
        header('X-Frame-Options: SAMEORIGIN');
        header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
        header('Cache-Control: no-store');
        try {
            $this->security->startSession();
            $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
            $path = parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?: '/';
            if ($path === '/api/stripe/webhook' || $path === '/api/razorpay/webhook') {
                $this->webhook($path);
            }
            if ($method !== 'GET' && $method !== 'HEAD') {
                $this->security->verifyCsrf();
            }
            if ($method === 'POST' && str_starts_with($path, '/api/checkout/')) {
                $this->security->enforceRateLimit('payment-initiation', 10, 900);
            } elseif ($method === 'POST' && preg_match('#^/api/(register|abstract|contact|brochure)$#', $path)) {
                $this->security->enforceRateLimit('public-submission', 30, 900);
            }
            $this->dispatch($method, $path);
        } catch (DomainException $error) {
            OperationalLogger::event('notice', 'request_validation_failed', ['exception' => $error::class]);
            Security::json(['ok' => false, 'error' => $error->getMessage()], 400);
        } catch (Throwable $error) {
            OperationalLogger::event('error', 'request_failed', ['exception' => $error::class]);
            Security::json([
                'ok' => false,
                'error' => 'The request could not be completed. Please try again later.',
                'requestId' => $requestId,
            ], 500);
        }
    }

    private function dispatch(string $method, string $path): never
    {
        if ($method === 'GET' && $path === '/api/sponsors-brochure-file') {
            $file = $this->root . '/uploads/Sponsors & Exhibition5.docx';
            if (!is_file($file) || !is_readable($file)) {
                Security::json(['ok' => false, 'error' => 'The sponsorship brochure is not available.'], 404);
            }
            header('Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            header('Content-Disposition: attachment; filename="MatAi-2027-Sponsors-and-Exhibition-Brochure.docx"');
            header('Content-Length: ' . (string) filesize($file));
            readfile($file);
            exit;
        }
        if ($method === 'GET' && $path === '/api/conference-brochure-file') {
            $file = $this->root . '/MatAi-2027-pdf.pdf';
            if (!is_file($file) || !is_readable($file)) {
                Security::json(['ok' => false, 'error' => 'The conference brochure is not available.'], 404);
            }
            header('Content-Type: application/pdf');
            header('Content-Disposition: attachment; filename="MatAi-2027-Conference-Brochure.pdf"');
            header('Content-Length: ' . (string) filesize($file));
            readfile($file);
            exit;
        }
        if ($method === 'GET' && $path === '/api/csrf') {
            Security::json(['ok' => true, 'token' => $this->security->csrfToken()]);
        }
        if ($method === 'GET' && $path === '/api/content') {
            Security::json(['ok' => true, 'content' => $this->store->content()]);
        }
        if ($method === 'GET' && $path === '/api/checkout/config') {
            $stripeEnabled = PaymentConfiguration::stripeEnabled(
                $this->config->get('STRIPE_SECRET_KEY'),
                $this->config->get('STRIPE_USD_CHECKOUT_VERIFIED')
            );
            $paypalEnabled = PaymentConfiguration::paypalEnabled(
                $this->config->get('PAYPAL_CLIENT_ID'),
                $this->config->get('PAYPAL_CLIENT_SECRET'),
                $this->config->get('PAYPAL_USD_CHECKOUT_VERIFIED')
            );
            $razorpayEnabled = PaymentConfiguration::razorpayEnabled(
                $this->config->get('RAZORPAY_KEY_ID'),
                $this->config->get('RAZORPAY_KEY_SECRET'),
                $this->config->get('RAZORPAY_CURRENCY', 'USD'),
                $this->config->get('RAZORPAY_USD_CHECKOUT_VERIFIED')
            );
            Security::json([
                'ok' => true,
                'stripe' => [
                    'enabled' => $stripeEnabled,
                    'currency' => $stripeEnabled ? 'USD' : null,
                    'supportedCurrencies' => $stripeEnabled ? ['USD'] : [],
                ],
                'paypal' => [
                    'enabled' => $paypalEnabled,
                    'mode' => $this->config->get('PAYPAL_MODE', 'sandbox'),
                    'currency' => $paypalEnabled ? 'USD' : null,
                    'supportedCurrencies' => $paypalEnabled ? ['USD'] : [],
                ],
                'razorpay' => [
                    'enabled' => $razorpayEnabled,
                    'keyId' => $razorpayEnabled ? $this->config->get('RAZORPAY_KEY_ID') : '',
                    'currency' => $razorpayEnabled ? 'USD' : null,
                    'supportedCurrencies' => $razorpayEnabled ? ['USD'] : [],
                ],
            ]);
        }
        if ($method === 'POST' && $path === '/admin/login') {
            $body = $this->body();
            if (!$this->security->login((string) ($body['username'] ?? ''), (string) ($body['password'] ?? ''))) {
                Security::json(['ok' => false, 'error' => 'Incorrect username or password, or login temporarily rate limited.'], 401);
            }
            Security::json(['ok' => true, 'csrf' => $this->security->csrfToken()]);
        }
        if ($method === 'POST' && $path === '/admin/logout') {
            $this->security->logout();
            Security::json(['ok' => true]);
        }
        if ($method === 'GET' && $path === '/admin/api/session') {
            $authenticated = $this->security->isAuthenticated();
            Security::json([
                'ok' => true,
                'authed' => $authenticated,
                'username' => $authenticated ? (string) ($_SESSION['admin_user'] ?? '') : '',
                'csrf' => $this->security->csrfToken(),
            ]);
        }
        if (preg_match('#^/api/checkout/stripe/status/(cs_[A-Za-z0-9_]+)$#', $path, $match) && $method === 'GET') {
            $this->stripeStatus($match[1]);
        }
        if ($method === 'GET' && $path === '/api/checkout/stripe/config') {
            $enabled = PaymentConfiguration::stripeEnabled(
                $this->config->get('STRIPE_SECRET_KEY'),
                $this->config->get('STRIPE_USD_CHECKOUT_VERIFIED')
            );
            Security::json([
                'ok' => true, 'enabled' => $enabled,
                'currency' => $enabled ? 'USD' : null,
                'supportedCurrencies' => $enabled ? ['USD'] : [],
            ]);
        }
        if ($method === 'POST' && $path === '/api/checkout/stripe') {
            $this->createStripeCheckout($this->body());
        }
        if ($method === 'POST' && $path === '/api/checkout/paypal/order') {
            $this->createPayPalOrder($this->body());
        }
        if ($method === 'POST' && $path === '/api/checkout/paypal/capture') {
            $this->capturePayPalOrder($this->body());
        }
        if ($method === 'POST' && $path === '/api/checkout/razorpay/order') {
            $this->createRazorpayOrder($this->body());
        }
        if ($method === 'POST' && $path === '/api/checkout/razorpay/verify') {
            $this->verifyRazorpayPayment($this->body());
        }
        if ($method === 'POST' && $path === '/api/checkout/razorpay/cancel') {
            $this->cancelRazorpayOrder($this->body());
        }
        if ($method === 'POST' && preg_match('#^/api/(register|abstract|contact|brochure)$#', $path, $match)) {
            $this->createSubmission($match[1]);
        }
        if (str_starts_with($path, '/admin/api/')) {
            $this->adminApi($method, $path);
        }
        if ($method === 'GET' && preg_match('#^/uploads/([a-f0-9]{48}\.(?:jpg|jpeg|png|gif|webp))$#', $path, $match)) {
            $this->servePublicImage($match[1]);
        }
        Security::json(['ok' => false, 'error' => 'Not found.'], 404);
    }

    private function createSubmission(string $kind): never
    {
        $data = $this->body();
        $required = [
            'register' => ['fullName', 'email', 'period', 'institution', 'country'],
            'abstract' => ['title', 'authorName', 'email', 'institution', 'country', 'session', 'abstract'],
            'contact' => ['fullName', 'email', 'subject', 'message'],
            'brochure' => ['fullName', 'email', 'phone', 'organization', 'country'],
        ][$kind];
        foreach ($required as $field) {
            if (!isset($data[$field]) || (is_string($data[$field]) && trim($data[$field]) === '')) {
                Security::json(['ok' => false, 'error' => 'Missing required fields.', 'fields' => [$field]], 400);
            }
        }
        if (!filter_var($data['email'], FILTER_VALIDATE_EMAIL)) {
            Security::json(['ok' => false, 'error' => 'Invalid email address.'], 400);
        }
        if ($kind === 'abstract') {
            if (!in_array($data['guidelinesAcknowledged'] ?? null, ['accepted', 'yes', true, 'true', 'on', 1], true)) {
                Security::json(['ok' => false, 'error' => 'You must read and agree to the Abstract Guidelines before submitting.'], 422);
            }
            // Never trust a client-provided consent timestamp or version.
            $data['guidelinesAcknowledged'] = true;
            $data['guidelinesConsentAt'] = gmdate(DATE_ATOM);
            $data['guidelinesVersion'] = self::ABSTRACT_GUIDELINES_VERSION;
        }
        $registration = null;
        if ($kind === 'register') {
            $registration = $this->registrations->prepare($data);
            if (($registration['data']['paymentGateway'] ?? '') !== 'Bank Transfer') {
                Security::json([
                    'ok' => false,
                    'error' => 'Online payment registrations must use the selected provider secure checkout flow.',
                ], 400);
            }
            $data = $registration['data'];
        }
        $attachment = $kind === 'abstract' ? $this->storeAbstractUpload() : null;
        $reference = $this->newReference();
        $record = [
            'reference' => $reference,
            'kind' => $kind,
            'receivedAt' => gmdate(DATE_ATOM),
            'ip' => (string) ($_SERVER['REMOTE_ADDR'] ?? ''),
            'status' => 'New',
            'data' => $this->sanitize($data),
        ];
        if ($attachment !== null) {
            $record['attachment'] = $attachment;
        }
        if ($registration !== null) {
            $record['paymentStatus'] = 'Pending';
            $record['amount'] = $registration['amount'];
            $record['amountCurrency'] = $registration['transactionCurrency'];
            $record['preferredCurrency'] = $registration['preferredCurrency'];
            $record['transactionCurrency'] = $registration['transactionCurrency'];
        }
        $this->store->mutate($kind, static function (array &$records) use ($record): void {
            $records[] = $record;
        });
        $this->notifications->notifySubmission($kind, $record);
        $result = ['ok' => true, 'reference' => $reference];
        if ($kind === 'brochure') {
            $result['download'] = (($data['brochureType'] ?? '') === 'conference')
                ? '/api/conference-brochure-file'
                : '/api/sponsors-brochure-file';
        }
        Security::json($result, 201);
    }

    private function storeAbstractUpload(): ?array
    {
        $file = $_FILES['attachment'] ?? null;
        if (!is_array($file) || (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            return null;
        }
        if ((int) $file['error'] !== UPLOAD_ERR_OK || (int) $file['size'] > 5 * 1024 * 1024) {
            Security::json(['ok' => false, 'error' => 'The abstract document must be 5 MB or smaller.'], 413);
        }
        $extension = strtolower(pathinfo((string) $file['name'], PATHINFO_EXTENSION));
        if (!in_array($extension, ['pdf', 'doc', 'docx'], true) || !is_uploaded_file((string) $file['tmp_name'])) {
            Security::json(['ok' => false, 'error' => 'Upload one PDF or Word document only.'], 400);
        }
        $signature = (string) file_get_contents((string) $file['tmp_name'], false, null, 0, 8);
        $valid = match ($extension) {
            'pdf' => str_starts_with($signature, '%PDF-'),
            'doc' => str_starts_with($signature, hex2bin('D0CF11E0A1B11AE1')),
            'docx' => str_starts_with($signature, "PK\x03\x04"),
        };
        if (!$valid) {
            Security::json(['ok' => false, 'error' => 'The uploaded file does not match its PDF or Word document type.'], 400);
        }
        $this->ensureUploadDirectory();
        $filename = bin2hex(random_bytes(24)) . '.' . $extension;
        if (!move_uploaded_file((string) $file['tmp_name'], $this->uploadDirectory . '/' . $filename)) {
            throw new RuntimeException('Could not store the abstract attachment.');
        }
        chmod($this->uploadDirectory . '/' . $filename, 0600);
        return [
            'filename' => $filename,
            'originalName' => $this->safeFilename((string) $file['name']),
            'mimeType' => (new \finfo(FILEINFO_MIME_TYPE))->file($this->uploadDirectory . '/' . $filename) ?: 'application/octet-stream',
            'size' => (int) $file['size'],
        ];
    }

    private function adminApi(string $method, string $path): never
    {
        $this->security->requireAdmin();
        if ($method === 'GET' && $path === '/admin/api/ops-status') {
            $this->operationalStatus();
        }
        if ($method === 'GET' && $path === '/admin/api/stats') {
            $counts = [];
            $revenue = 0.0;
            $pending = 0;
            $paid = 0;
            $recent = [];
            foreach (['register', 'abstract', 'contact', 'brochure'] as $kind) {
                $items = $this->store->submissions($kind);
                $counts[$kind] = count($items);
                foreach ($items as $item) {
                    if ($kind === 'register') {
                        if (($item['paymentStatus'] ?? '') === 'Paid') {
                            $revenue += (float) ($item['amount'] ?? 0);
                            $paid++;
                        } elseif (in_array($item['paymentStatus'] ?? 'Pending', ['', 'Pending'], true)) {
                            $pending++;
                        }
                    }
                    $recent[] = [
                        'reference' => $item['reference'] ?? '',
                        'kind' => $kind,
                        'receivedAt' => $item['receivedAt'] ?? '',
                        'paymentStatus' => $item['paymentStatus'] ?? '',
                    ];
                }
            }
            usort($recent, static fn (array $a, array $b): int => strcmp((string) $b['receivedAt'], (string) $a['receivedAt']));
            Security::json(['ok' => true, 'stats' => [
                'counts' => $counts, 'revenue' => $revenue, 'revenueCurrency' => 'USD', 'pending' => $pending, 'paid' => $paid,
                'recent' => array_slice($recent, 0, 10),
            ]]);
        }
        if ($method === 'GET' && preg_match('#^/admin/api/submissions/(register|abstract|contact|brochure)$#', $path, $match)) {
            Security::json(['ok' => true, 'items' => array_reverse($this->store->submissions($match[1]))]);
        }
        if ($method === 'GET' && $path === '/admin/api/submissions') {
            $items = [];
            foreach (['register', 'abstract', 'contact', 'brochure'] as $kind) {
                foreach ($this->store->submissions($kind) as $item) {
                    $items[] = ['kind' => $kind] + $item;
                }
            }
            usort($items, static fn (array $a, array $b): int => strcmp((string) ($b['receivedAt'] ?? ''), (string) ($a['receivedAt'] ?? '')));
            Security::json(['ok' => true, 'items' => $items]);
        }
        if ($method === 'GET' && preg_match('#^/admin/api/submissions/abstract/([A-Za-z0-9-]+)/attachment$#', $path, $match)) {
            $this->downloadAttachment($match[1]);
        }
        if ($method === 'GET' && preg_match('#^/admin/api/export/(all|register|abstract|contact|brochure)$#', $path, $match)) {
            $this->exportCsv($match[1]);
        }
        if ($method === 'PATCH' && preg_match('#^/admin/api/submissions/(register|abstract|contact|brochure)/([A-Za-z0-9-]+)$#', $path, $match)) {
            $this->updateSubmission($match[1], $match[2], $this->body());
        }
        if ($method === 'DELETE' && preg_match('#^/admin/api/submissions/(register|abstract|contact|brochure)/([A-Za-z0-9-]+)$#', $path, $match)) {
            $this->deleteSubmission($match[1], $match[2]);
        }
        if ($method === 'PUT' && $path === '/admin/api/content') {
            $body = $this->body();
            if (!isset($body['content']) || !is_array($body['content'])) {
                Security::json(['ok' => false, 'error' => 'Invalid content.'], 400);
            }
            $this->validateAdministrativeContent($body['content']);
            $this->store->saveContent($body['content']);
            Security::json(['ok' => true, 'content' => $body['content']]);
        }
        if ($method === 'POST' && $path === '/admin/api/upload-image') {
            $this->uploadImage();
        }
        Security::json(['ok' => false, 'error' => 'Not found.'], 404);
    }

    private function updateSubmission(string $kind, string $reference, array $body): never
    {
        $statuses = ['New', 'Reviewed', 'Approved', 'Rejected', 'Completed'];
        if ($kind === 'register' && array_key_exists('amount', $body)) {
            Security::json(['ok' => false, 'error' => 'Registration amount cannot be edited.'], 400);
        }
        if (array_key_exists('paymentStatus', $body)
            && ($kind !== 'register'
                || !in_array($body['paymentStatus'], ['Paid', 'Cancelled'], true)
                || !is_string($body['paymentEvidence'] ?? null)
                || trim($body['paymentEvidence']) === ''
                || mb_strlen(trim($body['paymentEvidence'])) > 200)) {
            Security::json(['ok' => false, 'error' => 'A bank-transfer confirmation or cancellation requires a short verification reference or reason.'], 400);
        }
        if (isset($body['status']) && !in_array($body['status'], $statuses, true)) {
            Security::json(['ok' => false, 'error' => 'Invalid submission status.'], 400);
        }
        if (isset($body['data']) && (!is_array($body['data']) || (isset($body['data']['email'])
                && !filter_var($body['data']['email'], FILTER_VALIDATE_EMAIL)))) {
            Security::json(['ok' => false, 'error' => 'Invalid submission data or email address.'], 400);
        }
        $record = $this->store->mutate($kind, static function (array &$records) use ($body, $reference, $kind): ?array {
            foreach ($records as &$item) {
                if (($item['reference'] ?? '') !== $reference) {
                    continue;
                }
                if (array_key_exists('paymentStatus', $body)) {
                    $gateway = ($item['data']['paymentGateway'] ?? '') ?: ($item['data']['paymentMethod'] ?? '');
                    $hasProviderOrder = !empty($item['stripeCheckoutSessionId'])
                        || !empty($item['paypalOrderId'])
                        || !empty($item['razorpayOrderId']);
                    if (($item['paymentStatus'] ?? '') !== 'Pending' || $gateway !== 'Bank Transfer' || $hasProviderOrder) {
                        return ['paymentUpdateBlocked' => true];
                    }
                }
                if (isset($body['status'])) {
                    $item['status'] = $body['status'];
                }
                if (array_key_exists('paymentStatus', $body)) {
                    $item['paymentStatus'] = $body['paymentStatus'];
                    $item['paymentVerification'] = [
                        'type' => 'manual-bank-transfer',
                        'outcome' => $body['paymentStatus'],
                        'evidence' => mb_substr(trim($body['paymentEvidence']), 0, 200),
                        'verifiedAt' => gmdate(DATE_ATOM),
                        'verifiedBy' => (string) ($_SESSION['admin_user'] ?? 'administrator'),
                    ];
                    OperationalLogger::event('warning', 'manual_bank_transfer_status_changed', [
                        'reference' => $reference,
                        'outcome' => $body['paymentStatus'],
                    ]);
                }
                if (isset($body['adminNotes'])) {
                    $item['adminNotes'] = mb_substr((string) $body['adminNotes'], 0, 2000);
                }
                if (isset($body['data'])) {
                    if ($kind !== 'register') {
                        $item['data'] = $body['data'];
                    } else {
                        $financialFields = [
                            'period', 'participantCount', 'category', 'selectedItems', 'totalPrice',
                            'totalPriceEUR', 'taxRate', 'taxAmount', 'paymentGateway', 'paymentMethod',
                            'couponCode', 'currency', 'preferredCurrency', 'transactionCurrency',
                            'currencyFallbackConfirmed', 'originalSelectedCurrency',
                        ];
                        foreach ($body['data'] as $field => $value) {
                            if (!in_array($field, $financialFields, true) && !str_starts_with((string) $field, 'qty_')) {
                                $item['data'][$field] = $value;
                            }
                        }
                    }
                }
                return $item;
            }
            return null;
        });
        if ($record === null) {
            Security::json(['ok' => false, 'error' => 'Not found.'], 404);
        }
        if (($record['paymentUpdateBlocked'] ?? false) === true) {
            Security::json(['ok' => false, 'error' => 'Only a pending bank-transfer registration can use manual payment verification.'], 409);
        }
        Security::json(['ok' => true, 'record' => $record]);
    }

    private function deleteSubmission(string $kind, string $reference): never
    {
        $deleted = $this->store->mutate($kind, static function (array &$records) use ($reference, $kind): ?array {
            foreach ($records as $index => $record) {
                if (($record['reference'] ?? '') === $reference) {
                    $hasProviderOrder = !empty($record['stripeCheckoutSessionId'])
                        || !empty($record['paypalOrderId'])
                        || !empty($record['razorpayOrderId'])
                        || !empty($record['paymentVerification']);
                    if ($kind === 'register' && (($record['paymentStatus'] ?? '') === 'Paid' || $hasProviderOrder)) {
                        return ['deletionBlocked' => true];
                    }
                    array_splice($records, $index, 1);
                    return $record;
                }
            }
            return null;
        });
        if ($deleted === null) {
            Security::json(['ok' => false, 'error' => 'Not found.'], 404);
        }
        if (($deleted['deletionBlocked'] ?? false) === true) {
            Security::json([
                'ok' => false,
                'error' => 'A registration with payment history cannot be deleted. Use the documented payment review process.',
            ], 409);
        }
        $filename = $deleted['attachment']['filename'] ?? '';
        if (preg_match('/^[a-f0-9]{48}\.(?:pdf|doc|docx)$/', (string) $filename)) {
            $path = $this->uploadDirectory . '/' . $filename;
            if (is_file($path) && !unlink($path)) {
                error_log('Could not remove an abstract attachment after record removal.');
            }
        }
        Security::json(['ok' => true]);
    }

    private function downloadAttachment(string $reference): never
    {
        foreach ($this->store->submissions('abstract') as $item) {
            $filename = $item['attachment']['filename'] ?? '';
            if (($item['reference'] ?? '') !== $reference
                || !preg_match('/^[a-f0-9]{48}\.(?:pdf|doc|docx)$/', (string) $filename)) {
                continue;
            }
            $path = $this->uploadDirectory . '/' . $filename;
            if (!is_file($path)) {
                Security::json(['ok' => false, 'error' => 'Attachment not found.'], 404);
            }
            header('Content-Type: application/octet-stream');
            header('X-Content-Type-Options: nosniff');
            header('Content-Disposition: attachment; filename="' . addcslashes($this->safeFilename((string) ($item['attachment']['originalName'] ?? 'abstract-document')), '"\\') . '"');
            header('Content-Length: ' . filesize($path));
            readfile($path);
            exit;
        }
        Security::json(['ok' => false, 'error' => 'Attachment not found.'], 404);
    }

    private function exportCsv(string $kind): never
    {
        $items = [];
        foreach ($kind === 'all' ? ['register', 'abstract', 'contact', 'brochure'] : [$kind] as $submissionKind) {
            foreach ($this->store->submissions($submissionKind) as $record) {
                $items[] = ['kind' => $submissionKind] + $record;
            }
        }
        $rows = [];
        foreach ($items as $record) {
            $rows[] = array_merge([
                'kind' => $record['kind'] ?? $kind,
                'reference' => $record['reference'] ?? '',
                'receivedAt' => $record['receivedAt'] ?? '',
                'status' => $record['status'] ?? '',
                'paymentStatus' => $record['paymentStatus'] ?? '',
                'amount' => $record['amount'] ?? '',
                'amountCurrency' => $record['amountCurrency'] ?? $record['transactionCurrency'] ?? '',
                'preferredCurrency' => $record['preferredCurrency'] ?? '',
                'transactionCurrency' => $record['transactionCurrency'] ?? '',
                'adminNotes' => $record['adminNotes'] ?? '',
            ], is_array($record['data'] ?? null) ? $record['data'] : []);
        }
        $columns = [];
        foreach ($rows as $row) {
            $columns = array_values(array_unique(array_merge($columns, array_keys($row))));
        }
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $kind . '-' . time() . '.csv"');
        $output = fopen('php://output', 'wb');
        if ($output === false) {
            throw new RuntimeException('Could not create the CSV export.');
        }
        fputcsv($output, $columns);
        foreach ($rows as $row) {
            fputcsv($output, array_map(static function (string $column) use ($row): string {
                $value = (string) ($row[$column] ?? '');
                return preg_match('/^\s*[=+\-@\t\r]/', $value) ? "'" . $value : $value;
            }, $columns));
        }
        fclose($output);
        exit;
    }

    private function uploadImage(): never
    {
        $file = $_FILES['image'] ?? null;
        if (!is_array($file) || (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK
            || (int) $file['size'] > 5 * 1024 * 1024 || !is_uploaded_file((string) $file['tmp_name'])) {
            Security::json(['ok' => false, 'error' => 'Choose an image no larger than 5 MB.'], 400);
        }
        $extension = strtolower(pathinfo((string) $file['name'], PATHINFO_EXTENSION));
        $allowed = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
        $mime = (new \finfo(FILEINFO_MIME_TYPE))->file((string) $file['tmp_name']);
        $types = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'gif' => 'image/gif', 'webp' => 'image/webp'];
        if (!in_array($extension, $allowed, true) || $types[$extension] !== $mime) {
            Security::json(['ok' => false, 'error' => 'Upload a valid JPEG, PNG, GIF, or WebP image.'], 400);
        }
        $bytes = (string) file_get_contents((string) $file['tmp_name'], false, null, 0, 12);
        $valid = match ($extension) {
            'jpg', 'jpeg' => str_starts_with($bytes, "\xff\xd8\xff"),
            'png' => str_starts_with($bytes, "\x89PNG\r\n\x1a\n"),
            'gif' => str_starts_with($bytes, 'GIF87a') || str_starts_with($bytes, 'GIF89a'),
            'webp' => substr($bytes, 0, 4) === 'RIFF' && substr($bytes, 8, 4) === 'WEBP',
        };
        if (!$valid) {
            Security::json(['ok' => false, 'error' => 'The uploaded file is not a valid image.'], 400);
        }
        $imageDirectory = $this->root . '/backend/data/images';
        if (!is_dir($imageDirectory) && !mkdir($imageDirectory, 0700, true) && !is_dir($imageDirectory)) {
            throw new RuntimeException('Could not create the image storage directory.');
        }
        $filename = bin2hex(random_bytes(24)) . '.' . $extension;
        if (!move_uploaded_file((string) $file['tmp_name'], $imageDirectory . '/' . $filename)) {
            throw new RuntimeException('Could not store the uploaded image.');
        }
        chmod($imageDirectory . '/' . $filename, 0600);
        Security::json(['ok' => true, 'path' => '/uploads/' . $filename]);
    }

    private function servePublicImage(string $filename): never
    {
        $path = $this->root . '/backend/data/images/' . $filename;
        if (!is_file($path)) {
            http_response_code(404);
            exit;
        }
        $mime = (new \finfo(FILEINFO_MIME_TYPE))->file($path);
        if (!in_array($mime, ['image/jpeg', 'image/png', 'image/gif', 'image/webp'], true)) {
            http_response_code(404);
            exit;
        }
        header('Content-Type: ' . $mime);
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: public, max-age=86400');
        readfile($path);
        exit;
    }

    private function stripeStatus(string $sessionId): never
    {
        if ($this->config->get('STRIPE_SECRET_KEY') === '') {
            Security::json(['ok' => false, 'error' => 'Stripe checkout is not configured.'], 503);
        }
        $session = $this->httpJson(
            'https://api.stripe.com/v1/checkout/sessions/' . rawurlencode($sessionId),
            'GET',
            ['Authorization: Bearer ' . $this->config->get('STRIPE_SECRET_KEY')]
        );
        $reference = $session['metadata']['reference'] ?? $session['client_reference_id'] ?? '';
        $record = $this->findBy($reference, 'stripeCheckoutSessionId', $sessionId);
        if ($record === null) {
            Security::json(['ok' => false, 'error' => 'Registration not found.'], 404);
        }
        $paid = ($session['payment_status'] ?? '') === 'paid';
        $expectedCurrency = $record['transactionCurrency'] ?? $record['amountCurrency'] ?? CurrencyPolicy::BASE_CURRENCY;
        if ($paid && !CurrencyPolicy::paymentMatches(
            $record['amount'] ?? null,
            $expectedCurrency,
            (int) ($session['amount_total'] ?? -1) / 100,
            (string) ($session['currency'] ?? '')
        )) {
            OperationalLogger::event('error', 'stripe_payment_amount_or_currency_mismatch');
            Security::json(['ok' => false, 'error' => 'Payment details did not match this registration.'], 409);
        }
        if ($paid) {
            $this->setPayment($reference, 'Paid', ['stripePaymentIntent' => $session['payment_intent'] ?? '']);
        } elseif (($session['status'] ?? '') === 'expired') {
            $this->setPayment($reference, 'Cancelled');
        }
        Security::json([
            'ok' => true, 'reference' => $reference,
            'paid' => $paid,
            'paymentStatus' => $paid ? 'Paid'
                : (($session['status'] ?? '') === 'expired' ? 'Cancelled' : 'Pending'),
            'amount' => $record['amount'],
            'currency' => $expectedCurrency,
        ]);
    }

    private function createStripeCheckout(array $body): never
    {
        $secret = $this->config->get('STRIPE_SECRET_KEY');
        if (!PaymentConfiguration::stripeEnabled($secret, $this->config->get('STRIPE_USD_CHECKOUT_VERIFIED'))) {
            Security::json(['ok' => false, 'error' => 'Stripe checkout is not enabled. The merchant must verify USD checkout before it can be used.'], 503);
        }
        $registration = $this->registrations->prepare($body);
        if (($registration['data']['paymentGateway'] ?? '') !== 'Stripe / Card Payment') {
            Security::json(['ok' => false, 'error' => 'Select Stripe / Card Payment to continue to checkout.'], 400);
        }
        $base = $this->baseUrl();
        if (str_starts_with($secret, 'sk_live_') && !str_starts_with($base, 'https://')) {
            Security::json(['ok' => false, 'error' => 'Live Stripe checkout requires HTTPS.'], 400);
        }
        $reference = $this->newReference();
        $description = implode(', ', array_map(
            static fn (array $item): string => $item['name'] . ' x' . $item['quantity'],
            $registration['items']
        ));
        $params = [
            'mode' => 'payment',
            'payment_method_types[0]' => 'card',
            'success_url' => $base . '/registration.html?checkout=success&session_id={CHECKOUT_SESSION_ID}',
            'cancel_url' => $base . '/registration.html?checkout=cancelled',
            'customer_email' => $registration['data']['email'],
            'client_reference_id' => $reference,
            'metadata[reference]' => $reference,
            'line_items[0][price_data][currency]' => strtolower($registration['transactionCurrency']),
            'line_items[0][price_data][product_data][name]' => 'MatAi 2027 Registration',
            'line_items[0][price_data][product_data][description]' => mb_substr($description, 0, 450),
            'line_items[0][price_data][unit_amount]' => (string) $registration['totalCents'],
            'line_items[0][quantity]' => '1',
        ];
        $session = $this->httpJson('https://api.stripe.com/v1/checkout/sessions', 'POST', [
            'Authorization: Bearer ' . $secret,
            'Content-Type: application/x-www-form-urlencoded',
        ], http_build_query($params));
        if (empty($session['id']) || empty($session['url'])
            || !CurrencyPolicy::paymentMatches(
                $registration['amount'],
                $registration['transactionCurrency'],
                (int) ($session['amount_total'] ?? -1) / 100,
                (string) ($session['currency'] ?? '')
            )) {
            throw new RuntimeException('Stripe checkout amount or currency did not match the confirmed registration.');
        }
        $this->saveRegistration($reference, $registration, ['stripeCheckoutSessionId' => $session['id']]);
        Security::json([
            'ok' => true, 'reference' => $reference, 'url' => $session['url'],
            'amount' => $registration['amount'], 'currency' => $registration['transactionCurrency'],
        ], 201);
    }

    private function createPayPalOrder(array $body): never
    {
        if (!PaymentConfiguration::paypalEnabled(
            $this->config->get('PAYPAL_CLIENT_ID'),
            $this->config->get('PAYPAL_CLIENT_SECRET'),
            $this->config->get('PAYPAL_USD_CHECKOUT_VERIFIED')
        )) {
            Security::json(['ok' => false, 'error' => 'PayPal checkout is not enabled. The merchant must verify USD checkout before it can be used.'], 503);
        }
        $registration = $this->registrations->prepare($body);
        if (($registration['data']['paymentGateway'] ?? '') !== 'PayPal') {
            Security::json(['ok' => false, 'error' => 'Select PayPal to continue.'], 400);
        }
        $reference = $this->newReference();
        $order = $this->paypalRequest('/v2/checkout/orders', [
            'intent' => 'CAPTURE',
            'purchase_units' => [[
                'reference_id' => $reference,
                'custom_id' => $reference,
                'description' => mb_substr($registration['data']['selectedItems'], 0, 120),
                'amount' => [
                    'currency_code' => $registration['transactionCurrency'],
                    'value' => number_format($registration['amount'], 2, '.', ''),
                ],
            ]],
            'payment_source' => ['paypal' => ['experience_context' => [
                'brand_name' => 'MatAi 2027',
                'user_action' => 'PAY_NOW',
                'return_url' => $this->baseUrl() . '/registration.html?checkout=paypal-return',
                'cancel_url' => $this->baseUrl() . '/registration.html?checkout=paypal-cancelled',
            ]]],
        ]);
        $approval = '';
        foreach ($order['links'] ?? [] as $link) {
            if (in_array($link['rel'] ?? '', ['payer-action', 'approve'], true)) {
                $approval = (string) ($link['href'] ?? '');
                break;
            }
        }
        $purchase = $this->paypalPurchase($order, $reference);
        if (empty($order['id']) || !$this->isPaypalUrl($approval) || $purchase === null
            || !CurrencyPolicy::paymentMatches(
                $registration['amount'],
                $registration['transactionCurrency'],
                $purchase['amount']['value'] ?? null,
                $purchase['amount']['currency_code'] ?? ''
            )) {
            throw new RuntimeException('PayPal order amount or currency did not match the confirmed registration.');
        }
        $this->saveRegistration($reference, $registration, ['paypalOrderId' => $order['id']]);
        Security::json([
            'ok' => true, 'reference' => $reference, 'orderId' => $order['id'],
            'approvalUrl' => $approval, 'amount' => $registration['amount'],
            'currency' => $registration['transactionCurrency'],
        ], 201);
    }

    private function capturePayPalOrder(array $body): never
    {
        $orderId = (string) ($body['orderId'] ?? '');
        if (!preg_match('/^[-A-Za-z0-9]+$/', $orderId)) {
            Security::json(['ok' => false, 'error' => 'Invalid PayPal order.'], 400);
        }
        $record = $this->findBy('', 'paypalOrderId', $orderId);
        if ($record === null) {
            Security::json(['ok' => false, 'error' => 'Registration not found for this PayPal order.'], 404);
        }
        if (($record['paymentStatus'] ?? '') === 'Paid') {
            Security::json([
                'ok' => true, 'paid' => true, 'reference' => $record['reference'],
                'amount' => $record['amount'], 'currency' => $record['transactionCurrency'] ?? $record['amountCurrency'] ?? CurrencyPolicy::BASE_CURRENCY,
            ]);
        }
        $order = $this->paypalRequest('/v2/checkout/orders/' . rawurlencode($orderId));
        $purchase = $this->paypalPurchase($order, $record['reference']);
        $expectedCurrency = $record['transactionCurrency'] ?? $record['amountCurrency'] ?? CurrencyPolicy::BASE_CURRENCY;
        if ($purchase === null || !CurrencyPolicy::paymentMatches(
            $record['amount'] ?? null,
            $expectedCurrency,
            $purchase['amount']['value'] ?? null,
            $purchase['amount']['currency_code'] ?? ''
        )) {
            OperationalLogger::event('error', 'paypal_payment_mismatch');
            Security::json(['ok' => false, 'error' => 'PayPal order amount or registration reference did not match.'], 400);
        }
        $captured = $order;
        if (($order['status'] ?? '') !== 'COMPLETED') {
            $captured = $this->paypalRequest('/v2/checkout/orders/' . rawurlencode($orderId) . '/capture', []);
        }
        $purchase = $this->paypalPurchase($captured, $record['reference']);
        $captures = $purchase['payments']['captures'] ?? [];
        foreach ($captures as $capture) {
            if (($capture['status'] ?? '') === 'COMPLETED'
                && CurrencyPolicy::paymentMatches(
                    $record['amount'] ?? null,
                    $expectedCurrency,
                    $capture['amount']['value'] ?? null,
                    $capture['amount']['currency_code'] ?? ''
                )) {
                $this->setPayment($record['reference'], 'Paid', ['paypalCaptureId' => $capture['id'] ?? '']);
                Security::json([
                    'ok' => true, 'paid' => true, 'reference' => $record['reference'],
                    'amount' => $record['amount'], 'currency' => $expectedCurrency,
                ]);
            }
        }
        OperationalLogger::event('warning', 'paypal_capture_not_completed');
        Security::json([
            'ok' => true, 'paid' => false, 'reference' => $record['reference'],
            'amount' => $record['amount'], 'currency' => $expectedCurrency,
            'error' => 'PayPal has not confirmed the payment yet.',
        ], 409);
    }

    private function createRazorpayOrder(array $body): never
    {
        $key = $this->config->get('RAZORPAY_KEY_ID');
        $secret = $this->config->get('RAZORPAY_KEY_SECRET');
        $currency = $this->config->get('RAZORPAY_CURRENCY', 'USD');
        if (!PaymentConfiguration::razorpayEnabled(
            $key, $secret, $currency, $this->config->get('RAZORPAY_USD_CHECKOUT_VERIFIED')
        )) {
            Security::json(['ok' => false, 'error' => 'Razorpay checkout is not enabled. The merchant must verify USD checkout before it can be used.'], 503);
        }
        $registration = $this->registrations->prepare($body);
        if (($registration['data']['paymentGateway'] ?? '') !== 'Razorpay') {
            Security::json(['ok' => false, 'error' => 'Select Razorpay to continue.'], 400);
        }
        $amount = (int) round($registration['amount'] * 100);
        if ($amount <= 0) {
            Security::json(['ok' => false, 'error' => 'Razorpay order amount is invalid.'], 400);
        }
        $reference = $this->newReference();
        $order = $this->razorpayRequest('orders', [
            'amount' => $amount, 'currency' => $currency, 'receipt' => $reference,
            'notes' => ['reference' => $reference, 'registration' => 'MatAi 2027'],
        ], 'POST');
        if (empty($order['id']) || !CurrencyPolicy::paymentMatches(
            $registration['amount'],
            $registration['transactionCurrency'],
            (int) ($order['amount'] ?? -1) / 100,
            (string) ($order['currency'] ?? '')
        )) {
            throw new RuntimeException('Razorpay order details did not match the requested amount.');
        }
        $this->saveRegistration($reference, $registration, ['razorpayOrderId' => $order['id'], 'razorpayCurrency' => $currency]);
        Security::json([
            'ok' => true, 'reference' => $reference, 'orderId' => $order['id'], 'keyId' => $key,
            'amount' => $amount, 'currency' => $registration['transactionCurrency'],
            'displayAmount' => $registration['amount'],
        ], 201);
    }

    private function verifyRazorpayPayment(array $body): never
    {
        $orderId = (string) ($body['razorpay_order_id'] ?? '');
        $paymentId = (string) ($body['razorpay_payment_id'] ?? '');
        $signature = (string) ($body['razorpay_signature'] ?? '');
        if (!preg_match('/^order_[A-Za-z0-9]+$/', $orderId) || !preg_match('/^pay_[A-Za-z0-9]+$/', $paymentId)
            || !preg_match('/^[a-f0-9]{64}$/i', $signature)) {
            Security::json(['ok' => false, 'error' => 'Invalid Razorpay payment response.'], 400);
        }
        $expected = hash_hmac('sha256', $orderId . '|' . $paymentId, $this->config->get('RAZORPAY_KEY_SECRET'));
        if (!hash_equals($expected, $signature)) {
            OperationalLogger::event('warning', 'razorpay_payment_signature_invalid');
            Security::json(['ok' => false, 'error' => 'Razorpay payment signature verification failed.'], 400);
        }
        $record = $this->findBy('', 'razorpayOrderId', $orderId);
        if ($record === null) {
            Security::json(['ok' => false, 'error' => 'Registration not found for this Razorpay order.'], 404);
        }
        if (($record['paymentStatus'] ?? '') === 'Paid') {
            Security::json([
                'ok' => true, 'paid' => true, 'reference' => $record['reference'],
                'amount' => $record['amount'],
                'currency' => $record['transactionCurrency'] ?? $record['razorpayCurrency'] ?? $record['amountCurrency'] ?? CurrencyPolicy::BASE_CURRENCY,
            ]);
        }
        $payment = $this->razorpayRequest('payments/' . rawurlencode($paymentId));
        $expectedCurrency = $record['transactionCurrency'] ?? $record['razorpayCurrency'] ?? $record['amountCurrency'] ?? CurrencyPolicy::BASE_CURRENCY;
        if (($payment['order_id'] ?? '') !== $orderId
            || !CurrencyPolicy::paymentMatches(
                $record['amount'] ?? null,
                $expectedCurrency,
                (int) ($payment['amount'] ?? -1) / 100,
                (string) ($payment['currency'] ?? '')
            )
            || !in_array($payment['status'] ?? '', ['authorized', 'captured'], true)) {
            OperationalLogger::event('error', 'razorpay_payment_mismatch');
            Security::json(['ok' => false, 'error' => 'Razorpay payment details did not match this registration.'], 400);
        }
        if ($payment['status'] === 'captured') {
            $this->setPayment($record['reference'], 'Paid', ['razorpayPaymentId' => $paymentId]);
            Security::json([
                'ok' => true, 'paid' => true, 'reference' => $record['reference'],
                'amount' => $record['amount'], 'currency' => $expectedCurrency,
            ]);
        }
        OperationalLogger::event('warning', 'razorpay_payment_not_captured');
        Security::json([
            'ok' => true, 'paid' => false, 'reference' => $record['reference'],
            'amount' => $record['amount'], 'currency' => $expectedCurrency,
        ]);
    }

    private function cancelRazorpayOrder(array $body): never
    {
        $orderId = (string) ($body['orderId'] ?? '');
        if (!preg_match('/^order_[A-Za-z0-9]+$/', $orderId)) {
            Security::json(['ok' => false, 'error' => 'Invalid Razorpay order.'], 400);
        }
        $record = $this->findBy('', 'razorpayOrderId', $orderId);
        if ($record !== null && ($record['paymentStatus'] ?? '') === 'Pending') {
            $this->setPayment($record['reference'], 'Cancelled');
        }
        Security::json(['ok' => true]);
    }

    private function webhook(string $path): never
    {
        $input = fopen('php://input', 'rb');
        if ($input === false) {
            throw new RuntimeException('Could not read the webhook body.');
        }
        $raw = stream_get_contents($input, 1024 * 1024 + 1);
        fclose($input);
        if ($raw === false || strlen($raw) > 1024 * 1024) {
            Security::json(['ok' => false, 'error' => 'Webhook body is too large.'], 413);
        }
        if ($path === '/api/stripe/webhook') {
            $this->stripeWebhook($raw);
        }
        $this->razorpayWebhook($raw);
    }

    private function stripeWebhook(string $raw): never
    {
        $secret = $this->config->get('STRIPE_WEBHOOK_SECRET');
        $header = (string) ($_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '');
        $timestamp = null;
        $signatures = [];
        foreach (explode(',', $header) as $part) {
            [$key, $value] = array_pad(explode('=', $part, 2), 2, '');
            if ($key === 't') {
                $timestamp = $value;
            } elseif ($key === 'v1') {
                $signatures[] = $value;
            }
        }
        if ($secret === '' || !ctype_digit((string) $timestamp)
            || abs(time() - (int) $timestamp) > 300 || $signatures === []) {
            OperationalLogger::event('warning', 'stripe_webhook_signature_invalid');
            Security::json(['ok' => false, 'error' => 'Invalid Stripe webhook signature.'], 400);
        }
        $expected = hash_hmac('sha256', $timestamp . '.' . $raw, $secret);
        $valid = false;
        foreach ($signatures as $signature) {
            $valid = $valid || (preg_match('/^[a-f0-9]{64}$/i', $signature) && hash_equals($expected, $signature));
        }
        if (!$valid) {
            OperationalLogger::event('warning', 'stripe_webhook_signature_invalid');
            Security::json(['ok' => false, 'error' => 'Invalid Stripe webhook signature.'], 400);
        }
        $event = json_decode($raw, true);
        if (!is_array($event)) {
            OperationalLogger::event('warning', 'stripe_webhook_payload_invalid');
            Security::json(['ok' => false, 'error' => 'Invalid Stripe event.'], 400);
        }
        $session = $event['data']['object'] ?? [];
        $eventType = $event['type'] ?? '';
        if (in_array($eventType, ['checkout.session.completed', 'checkout.session.async_payment_succeeded'], true)
            && ($session['payment_status'] ?? '') === 'paid') {
            $reference = $session['metadata']['reference'] ?? $session['client_reference_id'] ?? '';
            $record = $this->findBy($reference, 'stripeCheckoutSessionId', (string) ($session['id'] ?? ''));
            if ($record === null) {
                OperationalLogger::event('error', 'stripe_webhook_registration_unmatched');
            } else {
                $expectedCurrency = $record['transactionCurrency'] ?? $record['amountCurrency'] ?? CurrencyPolicy::BASE_CURRENCY;
                if (CurrencyPolicy::paymentMatches(
                $record['amount'] ?? null,
                $expectedCurrency,
                (int) ($session['amount_total'] ?? -1) / 100,
                (string) ($session['currency'] ?? '')
                )) {
                    $this->setPayment($reference, 'Paid', ['stripePaymentIntent' => $session['payment_intent'] ?? '']);
                } else {
                    OperationalLogger::event('error', 'stripe_payment_amount_or_currency_mismatch');
                }
            }
        } elseif (in_array($eventType, ['checkout.session.expired', 'checkout.session.async_payment_failed'], true)) {
            if ($eventType === 'checkout.session.async_payment_failed') {
                OperationalLogger::event('warning', 'stripe_async_payment_failed');
            }
            $reference = $session['metadata']['reference'] ?? $session['client_reference_id'] ?? '';
            $record = $this->findBy($reference, 'stripeCheckoutSessionId', (string) ($session['id'] ?? ''));
            if ($record !== null && ($record['paymentStatus'] ?? '') === 'Pending') {
                $this->setPayment($reference, 'Cancelled');
            }
        }
        Security::json(['received' => true]);
    }

    private function razorpayWebhook(string $raw): never
    {
        $secret = $this->config->get('RAZORPAY_WEBHOOK_SECRET');
        $signature = (string) ($_SERVER['HTTP_X_RAZORPAY_SIGNATURE'] ?? '');
        if ($secret === '' || !preg_match('/^[a-f0-9]{64}$/i', $signature)
            || !hash_equals(hash_hmac('sha256', $raw, $secret), $signature)) {
            OperationalLogger::event('warning', 'razorpay_webhook_signature_invalid');
            Security::json(['ok' => false, 'error' => 'Invalid Razorpay webhook signature.'], 400);
        }
        $event = json_decode($raw, true);
        if (!is_array($event)) {
            OperationalLogger::event('warning', 'razorpay_webhook_payload_invalid');
            Security::json(['ok' => false, 'error' => 'Invalid Razorpay event.'], 400);
        }
        $payment = $event['payload']['payment']['entity'] ?? [];
        $orderId = (string) ($payment['order_id'] ?? '');
        if (($event['event'] ?? '') === 'payment.captured' && $orderId !== '') {
            $record = $this->findBy('', 'razorpayOrderId', $orderId);
            if ($record === null) {
                OperationalLogger::event('error', 'razorpay_webhook_registration_unmatched');
            } elseif (CurrencyPolicy::paymentMatches(
                $record['amount'] ?? null,
                $record['transactionCurrency'] ?? $record['razorpayCurrency'] ?? $record['amountCurrency'] ?? CurrencyPolicy::BASE_CURRENCY,
                (int) ($payment['amount'] ?? -1) / 100,
                (string) ($payment['currency'] ?? '')
            )) {
                $this->setPayment($record['reference'], 'Paid', ['razorpayPaymentId' => $payment['id'] ?? '']);
            } else {
                OperationalLogger::event('error', 'razorpay_webhook_payment_mismatch');
            }
        } elseif (($event['event'] ?? '') === 'payment.failed' && $orderId !== '') {
            OperationalLogger::event('warning', 'razorpay_payment_failed');
            $record = $this->findBy('', 'razorpayOrderId', $orderId);
            if ($record !== null && ($record['paymentStatus'] ?? '') === 'Pending') {
                $this->setPayment($record['reference'], 'Failed');
            }
        }
        Security::json(['received' => true]);
    }

    private function saveRegistration(string $reference, array $registration, array $providerFields): void
    {
        $record = [
            'reference' => $reference,
            'kind' => 'register',
            'receivedAt' => gmdate(DATE_ATOM),
            'ip' => (string) ($_SERVER['REMOTE_ADDR'] ?? ''),
            'status' => 'New',
            'paymentStatus' => 'Pending',
            'amount' => $registration['amount'],
            'amountCurrency' => $registration['transactionCurrency'],
            'preferredCurrency' => $registration['preferredCurrency'],
            'transactionCurrency' => $registration['transactionCurrency'],
            'data' => $registration['data'],
        ] + $providerFields;
        $couponCode = strtoupper(trim((string) ($registration['data']['couponCode'] ?? '')));
        $maxUses = null;
        if ($couponCode !== '') {
            foreach (($this->store->content()['coupons'] ?? []) as $coupon) {
                if (is_array($coupon) && strtoupper(trim((string) ($coupon['code'] ?? ''))) === $couponCode) {
                    $maxUses = isset($coupon['maxUses']) ? (int) $coupon['maxUses'] : null;
                    break;
                }
            }
        }
        $this->store->mutate('register', static function (array &$records) use ($record, $couponCode, $maxUses): void {
            if ($couponCode !== '' && $maxUses !== null && $maxUses > 0) {
                $uses = 0;
                foreach ($records as $existing) {
                    if (strtoupper((string) ($existing['data']['couponCode'] ?? '')) === $couponCode
                        && in_array($existing['paymentStatus'] ?? '', ['Pending', 'Paid'], true)) {
                        $uses++;
                    }
                }
                if ($uses >= $maxUses) {
                    throw new DomainException('This coupon has reached its maximum number of uses.');
                }
            }
            $records[] = $record;
        });
        $this->notifications->notifySubmission('register', $record);
    }

    private function findBy(string $reference, string $field, string $value): ?array
    {
        foreach ($this->store->submissions('register') as $record) {
            if (($reference === '' || ($record['reference'] ?? '') === $reference)
                && ($record[$field] ?? '') === $value) {
                return $record;
            }
        }
        return null;
    }

    private function setPayment(string $reference, string $status, array $extra = []): void
    {
        $this->store->mutate('register', static function (array &$records) use ($reference, $status, $extra): void {
            foreach ($records as &$record) {
                if (($record['reference'] ?? '') === $reference) {
                    if ($status === 'Paid' && ($record['paymentStatus'] ?? '') === 'Paid') {
                        return;
                    }
                    $record['paymentStatus'] = $status;
                    foreach ($extra as $key => $value) {
                        $record[$key] = $value;
                    }
                    return;
                }
            }
        });
    }

    private function httpJson(string $url, string $method, array $headers, ?string $body = null): array
    {
        if (!function_exists('curl_init')) {
            throw new RuntimeException('PHP cURL is required for payment provider integrations.');
        }
        $handle = curl_init($url);
        if ($handle === false) {
            throw new RuntimeException('Could not initialize the payment provider request.');
        }
        curl_setopt_array($handle, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 30,
        ]);
        if ($body !== null) {
            curl_setopt($handle, CURLOPT_POSTFIELDS, $body);
        }
        $response = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        $error = curl_error($handle);
        curl_close($handle);
        if (!is_string($response)) {
            throw new RuntimeException('Payment provider request failed: ' . $error);
        }
        $result = json_decode($response, true);
        if (!is_array($result)) {
            throw new RuntimeException('Payment provider returned an invalid response.');
        }
        if ($status < 200 || $status >= 300) {
            $message = $result['error']['message'] ?? $result['message'] ?? 'Payment provider request failed.';
            throw new RuntimeException((string) $message);
        }
        return $result;
    }

    private function paypalRequest(string $path, ?array $body = null): array
    {
        $id = $this->config->get('PAYPAL_CLIENT_ID');
        $secret = $this->config->get('PAYPAL_CLIENT_SECRET');
        if ($id === '' || $secret === '') {
            Security::json(['ok' => false, 'error' => 'PayPal checkout is not configured.'], 503);
        }
        $base = $this->config->get('PAYPAL_MODE') === 'live'
            ? 'https://api-m.paypal.com'
            : 'https://api-m.sandbox.paypal.com';
        $token = $this->httpJson($base . '/v1/oauth2/token', 'POST', [
            'Authorization: Basic ' . base64_encode($id . ':' . $secret),
            'Content-Type: application/x-www-form-urlencoded',
        ], 'grant_type=client_credentials');
        if (empty($token['access_token'])) {
            throw new RuntimeException('PayPal authentication failed.');
        }
        $headers = ['Authorization: Bearer ' . $token['access_token'], 'Content-Type: application/json'];
        return $this->httpJson($base . $path, $body === null ? 'GET' : 'POST', $headers,
            $body === null ? null : json_encode($body, JSON_THROW_ON_ERROR));
    }

    private function razorpayRequest(string $path, ?array $body = null, string $method = 'GET'): array
    {
        $id = $this->config->get('RAZORPAY_KEY_ID');
        $secret = $this->config->get('RAZORPAY_KEY_SECRET');
        if ($id === '' || $secret === '') {
            Security::json(['ok' => false, 'error' => 'Razorpay checkout is not configured.'], 503);
        }
        $headers = ['Authorization: Basic ' . base64_encode($id . ':' . $secret), 'Content-Type: application/json'];
        return $this->httpJson('https://api.razorpay.com/v1/' . $path, $method, $headers,
            $body === null ? null : json_encode($body, JSON_THROW_ON_ERROR));
    }

    private function paypalPurchase(array $order, string $reference): ?array
    {
        foreach ($order['purchase_units'] ?? [] as $purchase) {
            if (($purchase['custom_id'] ?? '') === $reference) {
                return $purchase;
            }
        }
        return null;
    }

    private function isPaypalUrl(string $url): bool
    {
        $host = parse_url($url, PHP_URL_HOST);
        return parse_url($url, PHP_URL_SCHEME) === 'https'
            && is_string($host)
            && (strtolower($host) === 'paypal.com' || str_ends_with(strtolower($host), '.paypal.com'));
    }

    /** Validate financial configuration before it becomes live site content. */
    private function validateAdministrativeContent(array $content): void
    {
        $seen = [];
        foreach (($content['coupons'] ?? []) as $coupon) {
            if (!is_array($coupon)) {
                throw new DomainException('Each coupon must be an object.');
            }
            $code = strtoupper(trim((string) ($coupon['code'] ?? '')));
            if (!preg_match('/^[A-Z0-9][A-Z0-9_-]{2,63}$/', $code) || isset($seen[$code])) {
                throw new DomainException('Coupon codes must be unique and use 3–64 letters, numbers, hyphens, or underscores.');
            }
            $seen[$code] = true;
            $type = strtolower((string) ($coupon['discountType'] ?? 'percentage'));
            if (!in_array($type, ['percentage', 'fixed'], true)) {
                throw new DomainException('Coupon discount type must be percentage or fixed.');
            }
            $value = $type === 'fixed' ? ($coupon['fixedAmount'] ?? null) : ($coupon['discountPercentage'] ?? $coupon['percent'] ?? null);
            if (!is_numeric($value) || (float) $value <= 0 || ($type === 'percentage' && (float) $value > 100)) {
                throw new DomainException('Coupon discount value is invalid.');
            }
            if (isset($coupon['maxUses']) && (!filter_var($coupon['maxUses'], FILTER_VALIDATE_INT) || (int) $coupon['maxUses'] < 1)) {
                throw new DomainException('Coupon maximum uses must be a positive integer.');
            }
            if (!empty($coupon['validUntil']) && strtotime((string) $coupon['validUntil']) === false) {
                throw new DomainException('Coupon expiry must be a valid date and time.');
            }
        }
        if (isset($content['accommodation'])) {
            $accommodation = $content['accommodation'];
            if (!is_array($accommodation) || !is_numeric($accommodation['pricePerNight'] ?? null)
                || (float) $accommodation['pricePerNight'] < 0) {
                throw new DomainException('Accommodation price per night must be a valid monetary amount.');
            }
            foreach (['availableFrom', 'availableUntil'] as $field) {
                if (!empty($accommodation[$field]) && !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $accommodation[$field])) {
                    throw new DomainException('Accommodation availability dates must use YYYY-MM-DD.');
                }
            }
        }
    }

    private function body(): array
    {
        if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 6 * 1024 * 1024) {
            Security::json(['ok' => false, 'error' => 'Request body is too large.'], 413);
        }
        if ($_POST !== []) {
            return $this->sanitize($_POST);
        }
        $input = fopen('php://input', 'rb');
        if ($input === false) {
            throw new RuntimeException('Could not read the request body.');
        }
        $raw = stream_get_contents($input, 256 * 1024 + 1);
        fclose($input);
        if ($raw === false || strlen($raw) > 256 * 1024) {
            Security::json(['ok' => false, 'error' => 'Request body is too large.'], 413);
        }
        if ($raw === '') {
            return [];
        }
        $body = json_decode($raw, true);
        if (!is_array($body)) {
            Security::json(['ok' => false, 'error' => 'Request body must be a JSON object.'], 400);
        }
        return $this->sanitize($body);
    }

    private function operationalStatus(): never
    {
        $checks = [];
        try {
            if ($this->pdo !== null) {
                $query = $this->pdo->query('SELECT 1');
                if ($query === false || (int) $query->fetchColumn() !== 1) {
                    throw new RuntimeException('Database health query did not return the expected result.');
                }
                $checks['database'] = 'healthy';
            } else {
                $checks['database'] = 'json-storage';
            }
        } catch (Throwable $error) {
            OperationalLogger::event('error', 'health_database_check_failed', ['exception' => $error::class]);
            $checks['database'] = 'unavailable';
        }
        $checks['application_storage'] = is_dir($this->root . '/backend/data')
            && is_writable($this->root . '/backend/data') ? 'writable' : 'unavailable';
        $healthy = !in_array('unavailable', $checks, true);
        Security::json(['ok' => $healthy, 'checks' => $checks], $healthy ? 200 : 503);
    }

    private function sanitize(array $data): array
    {
        $result = [];
        foreach ($data as $key => $value) {
            if (is_string($value)) {
                $result[$key] = mb_substr($value, 0, 5000);
            } elseif (is_bool($value) || is_int($value) || is_float($value) || $value === null) {
                $result[$key] = $value;
            } elseif (is_array($value)) {
                $result[$key] = $value;
            }
        }
        return $result;
    }

    private function baseUrl(): string
    {
        $url = $this->config->get('APP_URL');
        if ($url === '') {
            throw new RuntimeException('Set APP_URL to the public application URL before initiating checkout.');
        }

        if (!filter_var($url, FILTER_VALIDATE_URL) || !in_array(parse_url($url, PHP_URL_SCHEME), ['http', 'https'], true)) {
            throw new RuntimeException('APP_URL must be a valid HTTP or HTTPS URL.');
        }
        return rtrim($url, '/');
    }

    private function newReference(): string
    {
        return 'MATAI-' . strtoupper(base_convert((string) time(), 10, 36)) . strtoupper(bin2hex(random_bytes(3)));
    }

    private function ensureUploadDirectory(): void
    {
        if (!is_dir($this->uploadDirectory)
            && !mkdir($this->uploadDirectory, 0700, true)
            && !is_dir($this->uploadDirectory)) {
            throw new RuntimeException('Could not create the private upload directory.');
        }
    }

    private function safeFilename(string $filename): string
    {
        $filename = basename(str_replace('\\', '/', $filename));
        $filename = preg_replace('/[\x00-\x1f\x7f]/', '', $filename) ?? '';
        return mb_substr($filename ?: 'abstract-document', 0, 180);
    }
}
