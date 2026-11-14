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
    private readonly ?PaymentVerificationService $paymentVerifications;
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
        $this->paymentVerifications = $this->pdo === null ? null : new PaymentVerificationService($this->pdo);
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
            if (in_array($path, ['/api/stripe/webhook', '/api/razorpay/webhook', '/api/paypal/webhook'], true)) {
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
        if ($method === 'GET' && $path === '/sitemap.xml') {
            header('Content-Type: application/xml; charset=utf-8');
            echo Seo::sitemapXml();
            exit;
        }
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
            $stripeEnabled = $this->pdo !== null && PaymentConfiguration::stripeEnabled(
                $this->config->get('STRIPE_SECRET_KEY'),
                $this->config->get('STRIPE_USD_CHECKOUT_VERIFIED')
            );
            $paypalEnabled = $this->pdo !== null && PaymentConfiguration::paypalEnabled(
                $this->config->get('PAYPAL_CLIENT_ID'),
                $this->config->get('PAYPAL_CLIENT_SECRET'),
                $this->config->get('PAYPAL_USD_CHECKOUT_VERIFIED'),
                $this->config->get('PAYPAL_MERCHANT_ID'),
                $this->config->get('PAYPAL_WEBHOOK_ID')
            );
            $razorpayEnabled = $this->pdo !== null && PaymentConfiguration::razorpayEnabled(
                $this->config->get('RAZORPAY_KEY_ID'),
                $this->config->get('RAZORPAY_KEY_SECRET'),
                $this->config->get('RAZORPAY_CURRENCY', 'USD'),
                $this->config->get('RAZORPAY_USD_CHECKOUT_VERIFIED')
            );
            Security::json([
                'ok' => true,
                'taxRateBasisPoints' => RegistrationService::TAX_RATE_BASIS_POINTS,
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
            $enabled = $this->pdo !== null && PaymentConfiguration::stripeEnabled(
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
        if ($method === 'POST' && $path === '/api/checkout/quote') {
            $this->checkoutQuote($this->body());
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
        if ($method === 'GET' && preg_match('#^/api/registrations/([A-Za-z0-9-]+)/payment-status$#', $path, $match)) {
            $this->registrationPaymentStatus($match[1]);
        }
        if ($method === 'GET' && preg_match('#^/api/registrations/([A-Za-z0-9-]+)/receipt$#', $path, $match)) {
            $this->downloadReceipt($match[1]);
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

    private function storeAbstractUpload(): array
    {
        $file = $_FILES['attachment'] ?? null;
        if (!is_array($file) || (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            Security::json(['ok' => false, 'error' => 'Please upload your abstract document.'], 400);
        }
        $uploadError = (int) $file['error'];
        if (in_array($uploadError, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)
            || (int) $file['size'] >= 5 * 1024 * 1024) {
            Security::json(['ok' => false, 'error' => 'The abstract document must be smaller than 5 MB.'], 413);
        }
        if ($uploadError !== UPLOAD_ERR_OK) {
            Security::json(['ok' => false, 'error' => 'The abstract document upload could not be processed. Please select it again and retry.'], 400);
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
        if ($method === 'GET' && preg_match('#^/admin/api/registrations/([A-Za-z0-9-]+)/payment$#', $path, $match)) {
            if ($this->paymentVerifications === null) {
                Security::json(['ok' => false, 'error' => 'Payment verification requires MySQL.'], 503);
            }
            Security::json(['ok' => true, 'payment' => $this->paymentVerifications->adminDetails($match[1])]);
        }
        if ($method === 'GET' && preg_match('#^/admin/api/registrations/([A-Za-z0-9-]+)/receipt$#', $path, $match)) {
            $this->downloadAdminReceipt($match[1]);
        }
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
        $this->requirePaymentPersistence();
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
        if ($paid && !CurrencyPolicy::paymentMatchesMinorUnits(
            $this->amountMinorUnits($record),
            $expectedCurrency,
            $session['amount_total'] ?? null,
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
        $this->requirePaymentPersistence();
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
        $this->saveRegistration($reference, $registration, []);
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
            'Idempotency-Key: ' . $reference,
        ], http_build_query($params));
        if (empty($session['id']) || empty($session['url'])
            || !CurrencyPolicy::paymentMatchesMinorUnits(
                $registration['totalCents'],
                $registration['transactionCurrency'],
                $session['amount_total'] ?? null,
                (string) ($session['currency'] ?? '')
            )) {
            throw new RuntimeException('Stripe checkout amount or currency did not match the confirmed registration.');
        }
        $this->updateRegistrationFields($reference, ['stripeCheckoutSessionId' => $session['id']]);
        Security::json([
            'ok' => true, 'reference' => $reference, 'url' => $session['url'],
            'amount' => $registration['amount'], 'currency' => $registration['transactionCurrency'],
        ], 201);
    }

    private function checkoutQuote(array $body): never
    {
        $registration = $this->registrations->prepare($body);
        $items = array_map(static function (array $item): array {
            return [
                'name' => $item['name'],
                'category' => $item['category'],
                'quantity' => $item['quantity'],
                'unitAmountMinor' => $item['unitCents'],
                'lineTotalMinor' => $item['unitCents'] * $item['quantity'],
            ];
        }, $registration['items']);
        Security::json([
            'ok' => true,
            'items' => $items,
            'currency' => $registration['transactionCurrency'],
            'participantCount' => $registration['data']['participantCount'],
            'period' => $registration['period'],
            'subtotalMinor' => $registration['grossCents'],
            'discountMinor' => $registration['discountCents'],
            'taxMinor' => $registration['taxCents'],
            'taxRateBasisPoints' => RegistrationService::TAX_RATE_BASIS_POINTS,
            'totalMinor' => $registration['totalCents'],
            'amount' => $registration['amount'],
            'accommodation' => [
                'type' => $registration['data']['accommodationType'] ?? '',
                'nights' => $registration['data']['accommodationNights'] ?? 0,
                'checkInDate' => $registration['data']['checkInDate'] ?? '',
                'checkOutDate' => $registration['data']['checkOutDate'] ?? '',
            ],
        ]);
    }

    private function createPayPalOrder(array $body): never
    {
        $this->requirePaymentPersistence();
        if (!PaymentConfiguration::paypalEnabled(
            $this->config->get('PAYPAL_CLIENT_ID'),
            $this->config->get('PAYPAL_CLIENT_SECRET'),
            $this->config->get('PAYPAL_USD_CHECKOUT_VERIFIED'),
            $this->config->get('PAYPAL_MERCHANT_ID'),
            $this->config->get('PAYPAL_WEBHOOK_ID')
        )) {
            Security::json(['ok' => false, 'error' => 'PayPal checkout is not enabled. The merchant must verify USD checkout before it can be used.'], 503);
        }
        $stage = 'registration_validation';
        try {
            $registration = $this->registrations->prepare($body);
            if (($registration['data']['paymentGateway'] ?? '') !== 'PayPal') {
                Security::json(['ok' => false, 'error' => 'Select PayPal to continue.'], 400);
            }
            $stage = 'registration_persistence';
            $reference = $this->newReference();
            $this->saveRegistration($reference, $registration, []);
            $stage = 'paypal_api';
            $order = $this->paypalRequest('/v2/checkout/orders', [
                'intent' => 'CAPTURE',
                'purchase_units' => [[
                    'reference_id' => $reference,
                    'custom_id' => $reference,
                    'description' => mb_substr($registration['data']['selectedItems'], 0, 120),
                    'payee' => ['merchant_id' => $this->config->get('PAYPAL_MERCHANT_ID')],
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
            ], $reference);
            $stage = 'paypal_order_validation';
            $approval = '';
            foreach ($order['links'] ?? [] as $link) {
                if (in_array($link['rel'] ?? '', ['payer-action', 'approve'], true)) {
                    $approval = (string) ($link['href'] ?? '');
                    break;
                }
            }
            $purchase = $this->paypalPurchase($order, $reference);
            $hasOrderId = !empty($order['id']);
            $hasApprovalUrl = $this->isPaypalUrl($approval);
            $purchaseMatched = $purchase !== null;
            $merchantMatched = $purchaseMatched
                && ($purchase['payee']['merchant_id'] ?? '') === $this->config->get('PAYPAL_MERCHANT_ID');
            $amountCurrencyMatched = $purchaseMatched && CurrencyPolicy::paymentMatches(
                    CurrencyPolicy::formatMinorUnits($registration['totalCents']),
                    $registration['transactionCurrency'],
                    $purchase['amount']['value'] ?? null,
                    $purchase['amount']['currency_code'] ?? ''
                );
            if (!$hasOrderId || !$hasApprovalUrl || !$purchaseMatched || !$merchantMatched || !$amountCurrencyMatched) {
                OperationalLogger::event('error', 'paypal_order_response_rejected', [
                    'has_order_id' => $hasOrderId,
                    'has_approval_url' => $hasApprovalUrl,
                    'purchase_unit_matched' => $purchaseMatched,
                    'merchant_matched' => $merchantMatched,
                    'amount_currency_matched' => $amountCurrencyMatched,
                ]);
                throw new RuntimeException('PayPal order amount or currency did not match the confirmed registration.');
            }
            $stage = 'registration_update';
            $this->updateRegistrationFields($reference, ['paypalOrderId' => $order['id']]);
        } catch (Throwable $error) {
            OperationalLogger::event('error', 'paypal_order_creation_failed', [
                'stage' => $stage,
                'exception' => $error::class,
            ]);
            throw $error;
        }
        Security::json([
            'ok' => true, 'reference' => $reference, 'orderId' => $order['id'],
            'approvalUrl' => $approval, 'amount' => $registration['amount'],
            'currency' => $registration['transactionCurrency'],
        ], 201);
    }

    private function capturePayPalOrder(array $body): never
    {
        $this->requirePaymentPersistence();
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
            $this->amountDecimal($record),
            $expectedCurrency,
            $purchase['amount']['value'] ?? null,
            $purchase['amount']['currency_code'] ?? ''
        )) {
            OperationalLogger::event('error', 'paypal_payment_mismatch');
            Security::json(['ok' => false, 'error' => 'PayPal order amount or registration reference did not match.'], 400);
        }
        if (($purchase['payee']['merchant_id'] ?? '') !== $this->config->get('PAYPAL_MERCHANT_ID')) {
            OperationalLogger::event('error', 'paypal_payee_mismatch');
            Security::json(['ok' => false, 'error' => 'The PayPal order belongs to a different merchant.'], 400);
        }
        $captured = $order;
        if (($order['status'] ?? '') !== 'COMPLETED') {
            $captured = $this->paypalRequest(
                '/v2/checkout/orders/' . rawurlencode($orderId) . '/capture',
                [],
                $orderId . '-capture'
            );
        }
        $purchase = $this->paypalPurchase($captured, $record['reference']);
        $captures = is_array($purchase) ? ($purchase['payments']['captures'] ?? []) : [];
        foreach ($captures as $capture) {
            if (($capture['status'] ?? '') === 'COMPLETED'
                && ($purchase['payee']['merchant_id'] ?? '') === $this->config->get('PAYPAL_MERCHANT_ID')
                && CurrencyPolicy::paymentMatches(
                    $this->amountDecimal($record),
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
        $this->requirePaymentPersistence();
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
        $amount = $registration['totalCents'];
        if ($amount <= 0) {
            Security::json(['ok' => false, 'error' => 'Razorpay order amount is invalid.'], 400);
        }
        $reference = $this->newReference();
        $this->saveRegistration($reference, $registration, []);
        $accessToken = bin2hex(random_bytes(32));
        if ($this->paymentVerifications === null) {
            throw new RuntimeException('Verified Razorpay receipts require MySQL persistence.');
        }
        $this->paymentVerifications->initiate(
            $reference,
            $registration['totalCents'],
            $registration['transactionCurrency'],
            $accessToken
        );
        $order = $this->razorpayRequest('orders', [
            'amount' => $amount, 'currency' => $currency, 'receipt' => $reference,
            'notes' => ['reference' => $reference, 'registration' => 'MatAi 2027'],
        ], 'POST');
        if (empty($order['id']) || !CurrencyPolicy::paymentMatchesMinorUnits(
            $registration['totalCents'],
            $registration['transactionCurrency'],
            $order['amount'] ?? null,
            (string) ($order['currency'] ?? '')
        )) {
            throw new RuntimeException('Razorpay order details did not match the requested amount.');
        }
        $this->paymentVerifications->attachOrder($reference, (string) $order['id']);
        $this->updateRegistrationFields($reference, ['razorpayOrderId' => $order['id'], 'razorpayCurrency' => $currency]);
        Security::json([
            'ok' => true, 'reference' => $reference, 'orderId' => $order['id'], 'keyId' => $key,
            'amount' => $amount, 'currency' => $registration['transactionCurrency'],
            'displayAmount' => $registration['amount'],
            'receiptAccessToken' => $accessToken,
        ], 201);
    }

    private function verifyRazorpayPayment(array $body): never
    {
        $this->requirePaymentPersistence();
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
        if ($this->paymentVerifications === null) {
            Security::json(['ok' => false, 'error' => 'Verified payment receipts require MySQL persistence.'], 503);
        }
        $record = $this->findBy('', 'razorpayOrderId', $orderId);
        if ($record === null) {
            Security::json(['ok' => false, 'error' => 'Registration not found for this Razorpay order.'], 404);
        }
        $accessToken = (string) ($_SERVER['HTTP_X_REGISTRATION_ACCESS'] ?? '');
        if ($accessToken === '') {
            Security::json(['ok' => false, 'error' => 'Registration access could not be verified.'], 403);
        }
        $payment = $this->razorpayRequest('payments/' . rawurlencode($paymentId));
        $providerOrder = $this->razorpayRequest('orders/' . rawurlencode($orderId));
        $expectedCurrency = $record['transactionCurrency'] ?? $record['razorpayCurrency'] ?? $record['amountCurrency'] ?? CurrencyPolicy::BASE_CURRENCY;
        if (($payment['id'] ?? '') !== $paymentId || ($payment['order_id'] ?? '') !== $orderId
            || !CurrencyPolicy::paymentMatchesMinorUnits(
                $this->amountMinorUnits($record),
                $expectedCurrency,
                $payment['amount'] ?? null,
                (string) ($payment['currency'] ?? '')
            )
            || !CurrencyPolicy::paymentMatchesMinorUnits(
                $this->amountMinorUnits($record),
                $expectedCurrency,
                $providerOrder['amount'] ?? null,
                (string) ($providerOrder['currency'] ?? '')
            )) {
            OperationalLogger::event('error', 'razorpay_payment_mismatch');
            Security::json(['ok' => false, 'error' => 'Razorpay payment details did not match this registration.'], 400);
        }
        if (($payment['status'] ?? '') !== 'captured') {
            Security::json([
                'ok' => true,
                'paid' => false,
                'verificationStatus' => 'PAYMENT_PROCESSING',
                'message' => 'Razorpay has not yet confirmed capture. Keep this page open while verification continues.',
            ], 202);
        }
        $verified = $this->paymentVerifications->recordVerifiedSignal(
            (string) $record['reference'],
            $orderId,
            $paymentId,
            'checkout',
            $providerOrder,
            $payment,
            $accessToken
        );
        Security::json(['ok' => true] + $verified, $verified['receiptReady'] ? 200 : 202);
    }

    private function cancelRazorpayOrder(array $body): never
    {
        $this->requirePaymentPersistence();
        $orderId = (string) ($body['orderId'] ?? '');
        if (!preg_match('/^order_[A-Za-z0-9]+$/', $orderId)) {
            Security::json(['ok' => false, 'error' => 'Invalid Razorpay order.'], 400);
        }
        $record = $this->findBy('', 'razorpayOrderId', $orderId);
        if ($record === null) {
            Security::json(['ok' => false, 'error' => 'Razorpay order was not found.'], 404);
        }
        Security::json([
            'ok' => true,
            'paymentStatus' => 'Pending',
            'message' => 'Checkout dismissal is not proof of failure; payment status remains pending verification.',
        ], 202);
    }

    private function webhook(string $path): never
    {
        $this->requirePaymentPersistence();
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
        if ($path === '/api/paypal/webhook') {
            $this->paypalWebhook($raw);
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
        $eventId = (string) ($event['id'] ?? '');
        if ($eventId === '' || strlen($eventId) > 128) {
            Security::json(['ok' => false, 'error' => 'Invalid Stripe event identifier.'], 400);
        }
        if ($this->webhookEventSeen('stripe', $eventId)) {
            Security::json(['received' => true, 'duplicate' => true]);
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
                if (CurrencyPolicy::paymentMatchesMinorUnits(
                    $this->amountMinorUnits($record),
                    $expectedCurrency,
                    $session['amount_total'] ?? null,
                    (string) ($session['currency'] ?? '')
                )) {
                    $this->setPayment($reference, 'Paid', ['stripePaymentIntent' => $session['payment_intent'] ?? '']);
                } else {
                    OperationalLogger::event('error', 'stripe_payment_amount_or_currency_mismatch');
                }
            }
        } elseif (in_array($eventType, ['checkout.session.expired', 'checkout.session.async_payment_failed'], true)) {
            $reference = $session['metadata']['reference'] ?? $session['client_reference_id'] ?? '';
            $record = $this->findBy($reference, 'stripeCheckoutSessionId', (string) ($session['id'] ?? ''));
            if ($record !== null && ($record['paymentStatus'] ?? '') === 'Pending') {
                $this->setPayment($reference, $eventType === 'checkout.session.expired' ? 'Cancelled' : 'Failed');
            }
        }
        $this->recordWebhookEvent(
            'stripe',
            $eventId,
            (string) $eventType,
            (string) ($session['id'] ?? ''),
            (string) ($session['client_reference_id'] ?? '')
        );
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
        $eventId = (string) ($_SERVER['HTTP_X_RAZORPAY_EVENT_ID'] ?? '');
        if ($eventId === '' || strlen($eventId) > 128) {
            Security::json(['ok' => false, 'error' => 'Invalid Razorpay event identifier.'], 400);
        }
        if ($this->paymentVerifications === null) {
            Security::json(['ok' => false, 'error' => 'Verified payment receipts require MySQL persistence.'], 503);
        }
        $payment = $event['payload']['payment']['entity'] ?? [];
        $orderId = (string) ($payment['order_id'] ?? '');
        $eventType = (string) ($event['event'] ?? '');
        if (!in_array($eventType, ['payment.captured', 'payment.failed'], true)) {
            if ($this->webhookEventSeen('razorpay', $eventId)) {
                Security::json(['received' => true, 'duplicate' => true]);
            }
            $this->recordWebhookEvent('razorpay', $eventId, $eventType, (string) ($payment['id'] ?? ''), '');
            Security::json(['received' => true]);
        }
        $paymentId = (string) ($payment['id'] ?? '');
        $reference = $orderId === '' ? null : $this->paymentVerifications->referenceForOrder($orderId);
        if ($reference === null || !preg_match('/^pay_[A-Za-z0-9]+$/', $paymentId)) {
            OperationalLogger::event('error', 'razorpay_webhook_registration_unmatched', ['order_id' => $orderId]);
            Security::json(['ok' => false, 'error' => 'Payment event did not match a registration order.'], 404);
        }
        $providerPayment = $this->razorpayRequest('payments/' . rawurlencode($paymentId));
        $providerOrder = $this->razorpayRequest('orders/' . rawurlencode($orderId));
        if ($eventType === 'payment.captured') {
            if (($providerPayment['status'] ?? '') !== 'captured') {
                Security::json(['ok' => false, 'error' => 'Razorpay has not confirmed payment capture.'], 409);
            }
            $result = $this->paymentVerifications->recordVerifiedSignal(
                $reference,
                $orderId,
                $paymentId,
                'webhook',
                $providerOrder,
                $providerPayment,
                null,
                ['id' => $eventId, 'type' => $eventType]
            );
            Security::json(['received' => true, 'verificationStatus' => $result['verificationStatus']]);
        }
        $result = $this->paymentVerifications->recordWebhookFailure(
            $reference,
            $orderId,
            $paymentId,
            ['id' => $eventId, 'event' => $eventType],
            $providerOrder,
            $providerPayment
        );
        Security::json(['received' => true, 'verificationStatus' => $result['verificationStatus']]);
    }

    private function registrationPaymentStatus(string $reference): never
    {
        if ($this->paymentVerifications === null) {
            Security::json(['ok' => false, 'error' => 'Payment verification requires MySQL.'], 503);
        }
        try {
            $status = $this->paymentVerifications->status(
                $reference,
                (string) ($_SERVER['HTTP_X_REGISTRATION_ACCESS'] ?? '')
            );
        } catch (\UnexpectedValueException) {
            Security::json(['ok' => false, 'error' => 'Registration access could not be verified.'], 403);
        }
        Security::json(['ok' => true] + $status);
    }

    private function downloadReceipt(string $reference): never
    {
        if ($this->paymentVerifications === null) {
            Security::json(['ok' => false, 'error' => 'Payment verification requires MySQL.'], 503);
        }
        $receipt = $this->paymentVerifications->receipt(
            $reference,
            (string) ($_SERVER['HTTP_X_REGISTRATION_ACCESS'] ?? '')
        );
        if ($receipt === null) {
            Security::json(['ok' => false, 'error' => 'A verified receipt is not available for this registration.'], 404);
        }
        $this->sendReceipt($receipt);
    }

    private function downloadAdminReceipt(string $reference): never
    {
        if ($this->paymentVerifications === null) {
            Security::json(['ok' => false, 'error' => 'Payment verification requires MySQL.'], 503);
        }
        $receipt = $this->paymentVerifications->receipt($reference, null, true);
        if ($receipt === null) {
            Security::json(['ok' => false, 'error' => 'A verified receipt is not available for this registration.'], 404);
        }
        $this->sendReceipt($receipt);
    }

    private function sendReceipt(array $receipt): never
    {
        header('Content-Type: application/pdf');
        header('Content-Disposition: attachment; filename="' . preg_replace('/[^A-Za-z0-9_-]/', '', $receipt['number']) . '.pdf"');
        header('Content-Length: ' . strlen($receipt['pdf']));
        header('Cache-Control: private, no-store, max-age=0');
        echo $receipt['pdf'];
        exit;
    }

    private function paypalWebhook(string $raw): never
    {
        $event = json_decode($raw, true);
        if (!is_array($event)) {
            Security::json(['ok' => false, 'error' => 'Invalid PayPal event.'], 400);
        }
        $eventId = (string) ($event['id'] ?? '');
        $eventType = (string) ($event['event_type'] ?? '');
        if ($eventId === '' || strlen($eventId) > 128 || $eventType === '') {
            Security::json(['ok' => false, 'error' => 'Invalid PayPal event identifier.'], 400);
        }
        $verification = [
            'auth_algo' => (string) ($_SERVER['HTTP_PAYPAL_AUTH_ALGO'] ?? ''),
            'cert_url' => (string) ($_SERVER['HTTP_PAYPAL_CERT_URL'] ?? ''),
            'transmission_id' => (string) ($_SERVER['HTTP_PAYPAL_TRANSMISSION_ID'] ?? ''),
            'transmission_sig' => (string) ($_SERVER['HTTP_PAYPAL_TRANSMISSION_SIG'] ?? ''),
            'transmission_time' => (string) ($_SERVER['HTTP_PAYPAL_TRANSMISSION_TIME'] ?? ''),
            'webhook_id' => $this->config->get('PAYPAL_WEBHOOK_ID'),
            'webhook_event' => $event,
        ];
        foreach (['auth_algo', 'cert_url', 'transmission_id', 'transmission_sig', 'transmission_time', 'webhook_id'] as $required) {
            if ($verification[$required] === '') {
                OperationalLogger::event('warning', 'paypal_webhook_headers_missing');
                Security::json(['ok' => false, 'error' => 'Invalid PayPal webhook signature.'], 400);
            }
        }
        $verificationResult = $this->paypalRequest('/v1/notifications/verify-webhook-signature', $verification);
        if (($verificationResult['verification_status'] ?? '') !== 'SUCCESS') {
            OperationalLogger::event('warning', 'paypal_webhook_signature_invalid');
            Security::json(['ok' => false, 'error' => 'Invalid PayPal webhook signature.'], 400);
        }
        if ($this->webhookEventSeen('paypal', $eventId)) {
            Security::json(['received' => true, 'duplicate' => true]);
        }

        $resource = is_array($event['resource'] ?? null) ? $event['resource'] : [];
        $reference = '';
        if ($eventType === 'PAYMENT.CAPTURE.COMPLETED') {
            $orderId = (string) ($resource['supplementary_data']['related_ids']['order_id'] ?? '');
            if ($orderId === '') {
                Security::json(['ok' => false, 'error' => 'PayPal capture is missing its order reference.'], 400);
            }
            $record = $this->findBy('', 'paypalOrderId', $orderId);
            if ($record === null) {
                OperationalLogger::event('warning', 'paypal_webhook_order_unmatched');
                Security::json(['ok' => false, 'error' => 'The PayPal order is not yet available.'], 503);
            }
            $reference = (string) $record['reference'];
            $order = $this->paypalRequest('/v2/checkout/orders/' . rawurlencode($orderId));
            $purchase = $this->paypalPurchase($order, $reference);
            if ($purchase === null) {
                OperationalLogger::event('error', 'paypal_webhook_payment_mismatch');
                Security::json(['ok' => false, 'error' => 'PayPal capture details did not match this order.'], 400);
            }
            $expectedCurrency = (string) ($record['transactionCurrency'] ?? $record['amountCurrency'] ?? CurrencyPolicy::BASE_CURRENCY);
            $captureMatches = false;
            foreach (($purchase['payments']['captures'] ?? []) as $capture) {
                if (($capture['id'] ?? '') === ($resource['id'] ?? '')
                    && ($capture['status'] ?? '') === 'COMPLETED'
                    && CurrencyPolicy::paymentMatches(
                        $this->amountDecimal($record),
                        $expectedCurrency,
                        $capture['amount']['value'] ?? null,
                        $capture['amount']['currency_code'] ?? ''
                    )) {
                    $captureMatches = true;
                    break;
                }
            }
            if (($order['status'] ?? '') !== 'COMPLETED'
                || $purchase === null
                || ($purchase['payee']['merchant_id'] ?? '') !== $this->config->get('PAYPAL_MERCHANT_ID')
                || !CurrencyPolicy::paymentMatches(
                    $this->amountDecimal($record),
                    $expectedCurrency,
                    $resource['amount']['value'] ?? null,
                    $resource['amount']['currency_code'] ?? ''
                )
                || !$captureMatches) {
                OperationalLogger::event('error', 'paypal_webhook_payment_mismatch');
                Security::json(['ok' => false, 'error' => 'PayPal capture details did not match this order.'], 400);
            }
            $this->setPayment($reference, 'Paid', ['paypalCaptureId' => (string) ($resource['id'] ?? '')]);
        }
        $this->recordWebhookEvent('paypal', $eventId, $eventType, (string) ($resource['id'] ?? ''), $reference);
        Security::json(['received' => true]);
    }

    private function webhookEventSeen(string $provider, string $eventId): bool
    {
        if ($this->pdo === null) {
            throw new RuntimeException('MySQL payment persistence is required for webhook processing.');
        }
        $query = $this->pdo->prepare(
            'SELECT 1 FROM matai_payment_events WHERE provider = ? AND provider_event_id = ?'
        );
        $query->execute([$provider, $eventId]);
        return $query->fetchColumn() !== false;
    }

    private function recordWebhookEvent(
        string $provider,
        string $eventId,
        string $eventType,
        string $resourceId,
        string $reference
    ): void {
        if ($this->pdo === null) {
            throw new RuntimeException('MySQL payment persistence is required for webhook processing.');
        }
        $payload = json_encode([
            'resourceId' => mb_substr($resourceId, 0, 128),
        ], JSON_THROW_ON_ERROR);
        $insert = $this->pdo->prepare(
            'INSERT IGNORE INTO matai_payment_events ' .
            '(provider, provider_event_id, registration_reference, event_type, payload_json) ' .
            'VALUES (?, ?, ?, ?, ?)'
        );
        $insert->execute([
            $provider,
            $eventId,
            $reference !== '' ? $reference : null,
            mb_substr($eventType, 0, 80),
            $payload,
        ]);
    }

    private function saveRegistration(string $reference, array $registration, array $providerFields): void
    {
        $snapshotItems = array_map(static function (array $item): array {
            $item['lineTotalCents'] = (int) $item['unitCents'] * (int) $item['quantity'];
            return $item;
        }, $registration['items']);
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
            'pricingSnapshot' => [
                'items' => $snapshotItems,
                'grossCents' => $registration['grossCents'],
                'discountCents' => $registration['discountCents'],
                'taxCents' => $registration['taxCents'],
                'totalCents' => $registration['totalCents'],
                'currency' => $registration['transactionCurrency'],
                'createdAt' => gmdate(DATE_ATOM),
            ],
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

    private function updateRegistrationFields(string $reference, array $fields): void
    {
        $updated = $this->store->mutate('register', static function (array &$records) use ($reference, $fields): bool {
            foreach ($records as &$record) {
                if (($record['reference'] ?? '') !== $reference) {
                    continue;
                }
                foreach ($fields as $key => $value) {
                    $record[$key] = $value;
                }
                return true;
            }
            return false;
        });
        if ($updated !== true) {
            throw new RuntimeException('Could not associate the provider order with its internal registration.');
        }
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
                    $current = $record['paymentStatus'] ?? 'Pending';
                    if ($current === 'Paid') {
                        return;
                    }
                    if ($status === 'Paid' && !in_array($current, ['Pending', 'Failed', 'Cancelled'], true)) {
                        return;
                    }
                    if (in_array($status, ['Failed', 'Cancelled'], true) && $current !== 'Pending') {
                        return;
                    }
                    if (!in_array($status, ['Paid', 'Failed', 'Cancelled'], true)) {
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

    private function requirePaymentPersistence(): void
    {
        if ($this->pdo === null) {
            OperationalLogger::event('error', 'payment_persistence_unavailable');
            Security::json([
                'ok' => false,
                'error' => 'Online payment processing is temporarily unavailable.',
            ], 503);
        }
    }

    private function amountMinorUnits(array $record): int
    {
        $snapshotAmount = $record['pricingSnapshot']['totalCents'] ?? null;
        if (is_int($snapshotAmount) && $snapshotAmount >= 0) {
            return $snapshotAmount;
        }
        return CurrencyPolicy::toMinorUnits($record['amount'] ?? null) ?? -1;
    }

    private function amountDecimal(array $record): ?string
    {
        $minorUnits = $this->amountMinorUnits($record);
        return $minorUnits < 0 ? null : CurrencyPolicy::formatMinorUnits($minorUnits);
    }

    private function httpJson(
        string $url,
        string $method,
        array $headers,
        ?string $body = null,
        ?string $provider = null
    ): array {
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
        $errorNumber = curl_errno($handle);
        $error = curl_error($handle);
        curl_close($handle);
        if (!is_string($response)) {
            if ($provider !== null) {
                OperationalLogger::event('error', 'payment_provider_transport_failed', [
                    'provider' => $provider,
                    'endpoint' => parse_url($url, PHP_URL_PATH),
                    'transport_error_code' => $errorNumber,
                ]);
            }
            throw new RuntimeException('Payment provider request failed: ' . $error);
        }
        $result = json_decode($response, true);
        if (!is_array($result)) {
            if ($provider !== null) {
                OperationalLogger::event('error', 'payment_provider_invalid_response', [
                    'provider' => $provider,
                    'endpoint' => parse_url($url, PHP_URL_PATH),
                    'http_status' => $status,
                ]);
            }
            throw new RuntimeException('Payment provider returned an invalid response.');
        }
        if ($status < 200 || $status >= 300) {
            if ($provider !== null) {
                $issueCodes = [];
                $details = $result['details'] ?? [];
                if (is_array($details)) {
                    foreach ($details as $detail) {
                        $issue = is_array($detail) ? ($detail['issue'] ?? null) : null;
                        if (is_string($issue) && preg_match('/^[A-Z0-9_.-]{1,80}$/', $issue)) {
                            $issueCodes[] = $issue;
                        }
                    }
                }
                $providerError = $result['name'] ?? 'unknown';
                $debugId = $result['debug_id'] ?? null;
                OperationalLogger::event('error', 'payment_provider_http_error', [
                    'provider' => $provider,
                    'endpoint' => parse_url($url, PHP_URL_PATH),
                    'http_status' => $status,
                    'provider_error' => is_string($providerError)
                        && preg_match('/^[A-Za-z0-9_.-]{1,80}$/', $providerError) ? $providerError : 'unknown',
                    'provider_debug_id' => is_string($debugId)
                        && preg_match('/^[A-Za-z0-9_.-]{1,80}$/', $debugId) ? $debugId : null,
                    'provider_issue_codes' => implode(',', array_unique($issueCodes)),
                ]);
            }
            $message = $result['error']['message'] ?? $result['message'] ?? 'Payment provider request failed.';
            throw new RuntimeException((string) $message);
        }
        return $result;
    }

    private function paypalRequest(string $path, ?array $body = null, ?string $requestId = null): array
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
        ], 'grant_type=client_credentials', 'paypal');
        if (empty($token['access_token'])) {
            OperationalLogger::event('error', 'paypal_authentication_response_invalid');
            throw new RuntimeException('PayPal authentication failed.');
        }
        $headers = ['Authorization: Bearer ' . $token['access_token'], 'Content-Type: application/json'];
        if ($requestId !== null && $requestId !== '') {
            $headers[] = 'PayPal-Request-Id: ' . $requestId;
        }
        return $this->httpJson($base . $path, $body === null ? 'GET' : 'POST', $headers,
            $body === null ? null : json_encode($body, JSON_THROW_ON_ERROR), 'paypal');
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
        $periods = $content['registrationPeriods'] ?? null;
        if ($periods !== null) {
            $periodNames = ['Early Bird', 'Mid-Term', 'On-Spot'];
            $categories = ['Speaker', 'Delegate', 'Poster', 'Student', 'Virtual'];
            if (!is_array($periods)
                || (isset($periods['active']) && !in_array($periods['active'], $periodNames, true))) {
                throw new DomainException('Registration period settings are invalid.');
            }
            foreach ($periodNames as $periodName) {
                $config = $periods[$periodName] ?? null;
                if ($config === null) {
                    continue;
                }
                if (!is_array($config)) {
                    throw new DomainException('Registration period settings are invalid.');
                }
                $categoryDeadlines = $config['categoryDeadlines'] ?? [];
                if (!is_array($categoryDeadlines)) {
                    throw new DomainException('Category deadlines must be an object.');
                }
                foreach ($categoryDeadlines as $category => $deadline) {
                    if (!in_array($category, $categories, true)
                        || (!is_string($deadline) || ($deadline !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $deadline)))) {
                        throw new DomainException('Category deadlines must use valid YYYY-MM-DD dates.');
                    }
                }
            }
        }
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
            if (isset($accommodation['maxNights'])
                && (!filter_var($accommodation['maxNights'], FILTER_VALIDATE_INT)
                    || (int) $accommodation['maxNights'] < 1 || (int) $accommodation['maxNights'] > 100)) {
                throw new DomainException('Accommodation maximum nights must be a whole number between 1 and 100.');
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
        if (str_starts_with(strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? '')), 'multipart/form-data')) {
            Security::json([
                'ok' => false,
                'error' => 'The upload could not be processed. Please choose a smaller document and try again.',
            ], 413);
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
