CREATE TABLE IF NOT EXISTS tickets (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL UNIQUE,
  ticket_number TEXT UNIQUE,
  buyer_name TEXT,
  whatsapp TEXT,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'awaiting_receipt',
  receipt_file_name TEXT,
  receipt_mime_type TEXT,
  receipt_data BYTEA,
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  receipt_uploaded_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS tickets_status_created_idx
  ON tickets (status, created_at DESC);
