<?php

declare(strict_types=1);

$root = dirname(__DIR__, 2);
$path = parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?: '/';
$frontend = realpath($root . '/frontend');
$publicFile = $root . '/frontend' . $path;

if (str_starts_with($path, '/api/') || str_starts_with($path, '/admin/') || str_starts_with($path, '/uploads/')) {
    require $root . '/frontend/api.php';
    return true;
}

if ($path !== '/' && preg_match('#(?:^|/)\.\.(?:/|$)#', rawurldecode($path))) {
    http_response_code(404);
    return true;
}
$resolvedFile = realpath($publicFile);
if ($resolvedFile !== false && $frontend !== false
    && str_starts_with($resolvedFile, $frontend . DIRECTORY_SEPARATOR)
    && is_file($resolvedFile)) {
    return false;
}

return false;
