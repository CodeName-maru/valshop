/**
 * Notifications Sent Repository
 * Port interface + Supabase adapter for tracking sent notifications
 */


/**
 * Port interface for notifications repository
 */
export interface NotificationsRepo {
  /**
   * Filter out skins that have already been notified for this rotation
   * Returns skin UUIDs that should be notified (not yet sent)
   */
  filterUnsent(
    userId: string,
    skinUuids: string[],
    rotationDate: Date
  ): Promise<string[]>;

  /**
   * Record that notifications were sent for these skins
   * Should only be called AFTER successful email dispatch
   */
  insert(userId: string, skinUuids: string[], rotationDate: Date): Promise<void>;
}

/**
 * Get KST rotation date from a JavaScript Date
 * Riot store rotates at 00:00 KST (UTC+9)
 *
 * @param date - Date to convert (default: now)
 * @returns Date set to 00:00 KST
 */
export function getKstRotationDate(date: Date = new Date()): Date {
  // Convert to KST (UTC+9)
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstTime = new Date(date.getTime() + kstOffset);

  // Set to start of day (00:00)
  const rotationDate = new Date(
    Date.UTC(kstTime.getUTCFullYear(), kstTime.getUTCMonth(), kstTime.getUTCDate())
  );

  return rotationDate;
}

/**
 * Create Supabase-backed notifications repository
 * Uses service role key to bypass RLS
 *
 * @param supabase - Supabase client (service role)
 * @returns NotificationsRepo instance
 */
export function createNotificationsRepo(supabase: any): NotificationsRepo {
  return {
    async filterUnsent(
      userId: string,
      skinUuids: string[],
      rotationDate: Date
    ): Promise<string[]> {
      if (skinUuids.length === 0) {
        return [];
      }

      const rotationDateStr = rotationDate.toISOString().split("T")[0];

      // Find already notified skins
      const { data, error } = await supabase
        .from("notifications_sent")
        .select("skin_uuid")
        .eq("user_id", userId)
        .eq("rotation_date", rotationDateStr)
        .in("skin_uuid", skinUuids);

      if (error) {
        throw new Error(`Failed to filter unsent: ${String(error.message)}`);
      }

      const alreadyNotified = new Set((data || []).map((row: any) => row.skin_uuid));

      // Return skins that haven't been notified yet
      return skinUuids.filter((uuid) => !alreadyNotified.has(uuid));
    },

    async insert(
      userId: string,
      skinUuids: string[],
      rotationDate: Date
    ): Promise<void> {
      if (skinUuids.length === 0) {
        return;
      }

      const rotationDateStr = rotationDate.toISOString().split("T")[0];

      const rows = skinUuids.map((skinUuid) => ({
        user_id: userId,
        skin_uuid: skinUuid,
        rotation_date: rotationDateStr,
      }));

      const { error } = await supabase
        .from("notifications_sent")
        .insert(rows);

      if (error) {
        throw new Error(`Failed to insert notifications: ${String(error.message)}`);
      }
    },
  };
}
