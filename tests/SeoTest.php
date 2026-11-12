<?php

declare(strict_types=1);

namespace MatAi\Tests;

use DOMDocument;
use MatAi\Seo;
use PHPUnit\Framework\TestCase;

final class SeoTest extends TestCase
{
    public function testSitemapIsValidXmlAndContainsOnlyCanonicalPublicPages(): void
    {
        $xml = Seo::sitemapXml();
        $document = new DOMDocument();
        self::assertTrue($document->loadXML($xml));

        $locations = $document->getElementsByTagName('loc');
        self::assertCount(14, $locations);
        $urls = [];
        foreach ($locations as $location) {
            $url = $location->textContent;
            self::assertStringStartsWith('https://matai2027.com/', $url);
            self::assertStringNotContainsString('?', $url);
            self::assertStringNotContainsString('/admin', $url);
            self::assertStringNotContainsString('/api/', $url);
            self::assertStringNotContainsString('/uploads/', $url);
            $urls[] = $url;
        }
        self::assertContains('https://matai2027.com/', $urls);
        self::assertNotContains('https://matai2027.com/index.html', $urls);
        self::assertCount(count(array_unique($urls)), $urls);
    }
}
