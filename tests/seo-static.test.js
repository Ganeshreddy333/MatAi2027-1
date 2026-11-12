"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const publicPages = [
  "index.html",
  "about.html",
  "abstracts.html",
  "brochure.html",
  "contact-us.html",
  "general-information.html",
  "meet-our-experts.html",
  "registration.html",
  "sessions.html",
  "speakers.html",
  "sponsors-brochure.html",
  "sponsors-exhibition.html",
  "sponsors.html",
  "venue.html"
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("public HTML pages have unique canonical, title, description and social metadata", () => {
  const titles = new Set();
  const descriptions = new Set();
  for (const page of publicPages) {
    const html = read("frontend/" + page);
    const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
    const description = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1];
    const expectedPath = page === "index.html" ? "/" : "/" + page;
    const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]*)"/i)?.[1];

    assert.ok(title, page + " must have a title");
    assert.ok(description, page + " must have a description");
    assert.equal(canonical, "https://matai2027.com" + expectedPath);
    assert.match(html, /<meta\s+property="og:title"/i);
    assert.match(html, /<meta\s+property="og:description"/i);
    assert.match(html, /<meta\s+property="og:url"/i);
    assert.match(html, /<meta\s+name="twitter:card"/i);
    assert.equal((html.match(/<h1\b/gi) || []).length, 1, page + " should have one H1");
    assert.ok(!titles.has(title), "duplicate title: " + title);
    assert.ok(!descriptions.has(description), "duplicate description: " + description);
    titles.add(title);
    descriptions.add(description);
  }
});

test("homepage Event JSON-LD parses and uses only confirmed event details", () => {
  const html = read("frontend/index.html");
  const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i)?.[1];
  assert.ok(jsonLd);
  const schema = JSON.parse(jsonLd);
  const event = schema["@graph"].find((item) => item["@type"] === "Event");
  assert.ok(event);
  assert.equal(event.startDate, "2027-10-13");
  assert.equal(event.endDate, "2027-10-14");
  assert.equal(event.location.name, "Berlin, Germany");
  assert.equal(event.location.address.addressLocality, "Berlin");
  assert.equal("eventAttendanceMode" in event, false);
  assert.equal("offers" in event, false);
});

test("sitemap allowlist contains exactly the public pages and excludes private routes", () => {
  const source = read("backend/src/Seo.php");
  const block = source.match(/private const PUBLIC_PAGES = \[([\s\S]*?)\];/)?.[1];
  assert.ok(block);
  const paths = Array.from(block.matchAll(/'([^']+)'/g), (match) => match[1]);
  const expectedPaths = publicPages.map((page) => page === "index.html" ? "/" : "/" + page);
  assert.deepEqual(paths, expectedPaths);
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(paths.every((item) => !/\?|\/admin|\/api\/|\/uploads\//.test(item)));
  assert.match(source, /ENT_XML1/);
});

test("robots allows public assets, declares the sitemap and discourages admin/API crawling", () => {
  const robots = read("frontend/robots.txt");
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Disallow: \/admin\.html$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.match(robots, /^Sitemap: https:\/\/matai2027\.com\/sitemap\.xml$/m);
  assert.doesNotMatch(robots, /^Disallow: \/(?:css|js|images)\/?$/m);
});
