-- ==============================================================================
-- OMNIFLOW D1 DATABASE MIGRATION: 0003_automation_settings.sql
-- Description: Business hours configuration and human handover timeout for
--              the Phase 2 Automation Engine.
-- ==============================================================================

-- 1. Handover timeout in minutes (null = indefinite pause until manual reset)
ALTER TABLE tenant_settings ADD COLUMN handover_timeout_minutes INTEGER DEFAULT NULL;

-- 2. Business hours JSON configuration (null = always on)
-- Schema: {"startHour": 9, "endHour": 18, "timezone": "Asia/Kolkata"}
ALTER TABLE tenant_settings ADD COLUMN business_hours_json TEXT DEFAULT NULL;
