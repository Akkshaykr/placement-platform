-- Phase 2 / migration 9 of the series (enum step).
--
-- Adds the CANCELLED lifecycle state. It lives in its own migration because PostgreSQL refuses to
-- use a newly added enum value inside the transaction that added it; the functions in the next
-- migrations reference it, so it must already be committed.

alter type public.challenge_status add value if not exists 'CANCELLED' after 'REJECTED';
