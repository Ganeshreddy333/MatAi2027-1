<?php

declare(strict_types=1);

namespace MatAi;

final class Seo
{
    private const BASE_URL = 'https://matai2027.com';

    private const PUBLIC_PAGES = [
        '/',
        '/about.html',
        '/abstracts.html',
        '/brochure.html',
        '/contact-us.html',
        '/general-information.html',
        '/meet-our-experts.html',
        '/registration.html',
        '/sessions.html',
        '/speakers.html',
        '/sponsors-brochure.html',
        '/sponsors-exhibition.html',
        '/sponsors.html',
        '/venue.html',
    ];

    public static function sitemapXml(): string
    {
        $xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
        $xml .= '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
        foreach (self::PUBLIC_PAGES as $path) {
            $location = htmlspecialchars(self::BASE_URL . $path, ENT_XML1 | ENT_QUOTES, 'UTF-8');
            $xml .= "  <url><loc>{$location}</loc></url>\n";
        }
        return $xml . "</urlset>\n";
    }
}
