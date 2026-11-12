<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$path = parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?: '/';
if ($path === '/sitemap.xml') {
    require $root . '/vendor/autoload.php';
    header('Content-Type: application/xml; charset=utf-8');
    header('Cache-Control: public, max-age=3600, stale-while-revalidate=86400');
    echo \MatAi\Seo::sitemapXml();
    exit;
}

require dirname(__DIR__) . '/backend/php/index.php';
