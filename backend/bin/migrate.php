<?php

declare(strict_types=1);

use MatAi\Config;
use MatAi\Database;

require dirname(__DIR__, 2) . '/vendor/autoload.php';

$root = dirname(__DIR__, 2);
try {
    (new Database(Config::load($root)))->applyMigrations($root);
    fwrite(STDOUT, "Database migrations applied; legacy JSON data imported once if required.\n");
} catch (Throwable $error) {
    fwrite(STDERR, "Migration failed: " . $error->getMessage() . "\n");
    exit(1);
}
