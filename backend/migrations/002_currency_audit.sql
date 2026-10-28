ALTER TABLE matai_submissions
    ADD COLUMN amount_currency CHAR(3) NULL,
    ADD COLUMN preferred_currency CHAR(3) NULL,
    ADD COLUMN transaction_currency CHAR(3) NULL;

UPDATE matai_submissions
SET amount_currency = COALESCE(
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.amountCurrency')), 'null'),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.transactionCurrency')), 'null'),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.razorpayCurrency')), 'null')
    ),
    preferred_currency = COALESCE(
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.preferredCurrency')), 'null'),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.data.originalSelectedCurrency')), 'null'),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.data.currency')), 'null')
    ),
    transaction_currency = COALESCE(
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.transactionCurrency')), 'null'),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.amountCurrency')), 'null'),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.razorpayCurrency')), 'null')
    )
WHERE kind = 'register';
