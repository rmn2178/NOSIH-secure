-- NOSIH — Supabase schema (land deed registry)
-- Run this once in the Supabase SQL editor. Safe to re-run.
-- The legacy passport `certificates` table was dropped when the database was
-- reset to a fresh NOSIH install; nothing references it.

-- ── Users (registrars / admins) ───────────────────────────
create table if not exists users (
  id                uuid primary key default gen_random_uuid(),
  email             text not null unique,
  password_hash     text not null,              -- bcrypt, 12 rounds
  role              text not null default 'issuer' check (role in ('admin', 'issuer')),
  wallet_address    text,
  organization_name text,                       -- registration office
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── Owners (off-chain registry identities) ────────────────
-- On-chain only keccak256(owner_id) is stored — never names or ID numbers.
create table if not exists owners (
  id             uuid primary key default gen_random_uuid(),
  owner_id       text not null unique,          -- OWN-XXXXXXXX
  owner_hash     char(66) not null unique,      -- 0x + keccak256(owner_id), the on-chain value
  full_name      text not null,
  match_key      text not null unique,          -- keyed hash of normalized name + govt ID ref
  gov_id_hash    char(64),                      -- keyed hash of government ID (never plaintext)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ── Land records (off-chain mirror + private details) ─────
create table if not exists land_records (
  id                   uuid primary key default gen_random_uuid(),

  -- Human-readable identifiers
  land_id              text not null,           -- LAND-XXXXXXXXXX (shown on QR)
  record_id            text not null unique,    -- REC-XXXXXXXX
  previous_record_id   text,                    -- REC-… of the preceding record (null if first)
  previous_owner_id    text references owners(owner_id),
  current_owner_id     text not null references owners(owner_id),

  -- The 12 on-chain fields (bytes32 as 0x-hex)
  property_id          char(66) not null,
  survey_number_hash   char(66) not null,
  jurisdiction_code    text not null,           -- plain code; bytes32-encoded on-chain
  land_details_hash    char(66) not null,
  document_hash        char(66) not null unique,-- duplicate-PDF guard
  metadata_hash        char(66) not null,
  ipfs_cid             text not null,           -- CID of the ENCRYPTED PDF
  record_id_hash       char(66) not null unique,
  previous_record_hash char(66) not null,
  previous_owner_hash  char(66) not null,
  current_owner_hash   char(66) not null,
  registered_at        timestamptz,

  -- Private land details (never on-chain)
  survey_number        text not null,
  subdivision_number   text,
  area                 numeric,
  area_unit            text,
  boundary_north       text,
  boundary_south       text,
  boundary_east        text,
  boundary_west        text,
  village              text,
  taluk                text,
  district             text,
  state                text,

  -- Document metadata
  document_type        text,                    -- Sale Deed, Gift Deed, Settlement…
  registration_number  text,
  registration_date    date,
  sro_office           text,

  -- Storage / chain bookkeeping
  enc_iv               text not null,           -- AES-256-GCM IV (hex)
  enc_tag              text not null,           -- AES-256-GCM auth tag (hex)
  original_filename    text,
  tx_hash              text,
  qr_code_data         text,                    -- PNG data URI with land ID label
  verify_url           text,
  is_latest            boolean not null default true,
  status               text not null default 'active' check (status in ('active', 'revoked')),
  revoked_tx_hash      text,
  revoked_at           timestamptz,
  revoke_reason        text,
  registered_by        uuid references users(id),

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- One "latest" record per parcel — the head of the ownership chain.
create unique index if not exists land_records_one_latest_per_land
  on land_records (land_id) where is_latest;
create index if not exists land_records_land_id_idx       on land_records (land_id);
create index if not exists land_records_survey_number_idx on land_records (survey_number);
create index if not exists land_records_current_owner_idx on land_records (current_owner_id);
create index if not exists land_records_created_at_idx    on land_records (created_at desc);

-- ── updated_at maintenance ────────────────────────────────
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists users_set_updated_at on users;
create trigger users_set_updated_at
  before update on users for each row execute function set_updated_at();

drop trigger if exists owners_set_updated_at on owners;
create trigger owners_set_updated_at
  before update on owners for each row execute function set_updated_at();

drop trigger if exists land_records_set_updated_at on land_records;
create trigger land_records_set_updated_at
  before update on land_records for each row execute function set_updated_at();

-- ── Defense in depth ──────────────────────────────────────
-- Backend uses the service-role key (bypasses RLS). With RLS on and no
-- policies, the anon key can never read these tables.
alter table users        enable row level security;
alter table owners       enable row level security;
alter table land_records enable row level security;
