CREATE TABLE IF NOT EXISTS matai_submissions (
    kind VARCHAR(24) NOT NULL,
    reference VARCHAR(80) NOT NULL,
    received_at VARCHAR(40) NOT NULL,
    status VARCHAR(24) NULL,
    payment_status VARCHAR(24) NULL,
    amount DECIMAL(12,2) NULL,
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
