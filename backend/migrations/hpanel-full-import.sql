-- MatAi 2027 complete fresh-install schema for hPanel/phpMyAdmin.
-- Import this ONE file into an empty database. It is not for an existing
-- installation already created with the incremental migrations.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS matai_submissions (
    kind VARCHAR(24) NOT NULL,
    reference VARCHAR(80) NOT NULL,
    received_at VARCHAR(40) NOT NULL,
    status VARCHAR(24) NULL,
    payment_status VARCHAR(24) NULL,
    amount DECIMAL(12,2) NULL,
    amount_currency CHAR(3) NULL,
    preferred_currency CHAR(3) NULL,
    transaction_currency CHAR(3) NULL,
    record_json JSON NOT NULL,
    PRIMARY KEY (kind, reference),
    KEY idx_matai_submissions_recent (kind, received_at),
    KEY idx_matai_submissions_payment (kind, payment_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS matai_submission_locks (
    kind VARCHAR(24) NOT NULL PRIMARY KEY
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS matai_site_content (
    content_key VARCHAR(64) NOT NULL PRIMARY KEY,
    content_json JSON NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS matai_login_attempts (
    attempt_key CHAR(64) NOT NULL PRIMARY KEY,
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    window_started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS matai_api_rate_limits (
    rate_key CHAR(64) NOT NULL PRIMARY KEY,
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    window_started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS matai_payment_events (
    provider VARCHAR(24) NOT NULL,
    provider_event_id VARCHAR(128) NOT NULL,
    registration_reference VARCHAR(80) NULL,
    event_type VARCHAR(80) NOT NULL,
    received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    payload_json JSON NOT NULL,
    PRIMARY KEY (provider, provider_event_id),
    KEY idx_matai_payment_events_registration (registration_reference)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS matai_coupon_redemptions (
    registration_reference VARCHAR(80) NOT NULL,
    coupon_code VARCHAR(64) NOT NULL,
    reserved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    redeemed_at TIMESTAMP NULL,
    PRIMARY KEY (registration_reference),
    KEY idx_matai_coupon_redemptions_code (coupon_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS matai_migrations (
    migration_key VARCHAR(100) NOT NULL PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO matai_migrations (migration_key)
VALUES ('001_initial'), ('002_currency_audit'), ('003_payment_coupon_audit');
