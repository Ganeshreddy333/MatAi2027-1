-- Additive audit structures. Existing submission records remain the source of truth.
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
