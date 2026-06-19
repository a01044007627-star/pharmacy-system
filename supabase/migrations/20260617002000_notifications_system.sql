-- ===================================================================
-- NOTIFICATIONS SYSTEM - In-App Notifications + Deleted Audit
-- ===================================================================

-- ========================
-- IN-APP NOTIFICATIONS
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_inapp_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  notif_type TEXT NOT NULL DEFAULT 'info' CHECK(notif_type IN ('warning','success','info','error')),
  href TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notif_user_created
  ON pharmacy_inapp_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notif_active
  ON pharmacy_inapp_notifications(user_id, read, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE pharmacy_inapp_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notif_owner_select ON pharmacy_inapp_notifications;
CREATE POLICY notif_owner_select
  ON pharmacy_inapp_notifications FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS notif_owner_insert ON pharmacy_inapp_notifications;
CREATE POLICY notif_owner_insert
  ON pharmacy_inapp_notifications FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS notif_owner_update ON pharmacy_inapp_notifications;
CREATE POLICY notif_owner_update
  ON pharmacy_inapp_notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- ========================
-- DELETED NOTIFICATIONS AUDIT
-- ========================
CREATE TABLE IF NOT EXISTS pharmacy_inapp_deleted_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  original_id UUID,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  notif_type TEXT NOT NULL DEFAULT 'info',
  href TEXT,
  was_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_inapp_deleted_notif_user
  ON pharmacy_inapp_deleted_notifications(user_id, deleted_at DESC);

ALTER TABLE pharmacy_inapp_deleted_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inapp_deleted_notif_owner_select ON pharmacy_inapp_deleted_notifications;
CREATE POLICY inapp_deleted_notif_owner_select
  ON pharmacy_inapp_deleted_notifications FOR SELECT
  USING (auth.uid() = user_id);

-- ========================
-- TRIGGER: auto-archive on soft-delete
-- ========================
CREATE OR REPLACE FUNCTION fn_archive_deleted_notification()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    INSERT INTO pharmacy_inapp_deleted_notifications (
      user_id, original_id, title, description, notif_type, href, was_read, created_at, deleted_by
    ) VALUES (
      NEW.user_id, NEW.id, NEW.title, NEW.description, NEW.notif_type,
      NEW.href, NEW.read, NEW.created_at, auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_archive_deleted_notification ON pharmacy_inapp_notifications;

CREATE TRIGGER trg_archive_deleted_notification
  BEFORE UPDATE OF deleted_at ON pharmacy_inapp_notifications
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION fn_archive_deleted_notification();
