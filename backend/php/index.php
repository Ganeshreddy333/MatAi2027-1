<?php

declare(strict_types=1);

use MatAi\Application;
use MatAi\Config;

$root = dirname(__DIR__, 2);
if (PHP_SAPI !== 'cli') {
    ini_set('display_errors', '0');
    error_reporting(E_ALL);
}
require $root . '/vendor/autoload.php';

(new Application(Config::load($root)))->run();
