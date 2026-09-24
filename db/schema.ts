// Maxpro durable data schema. The production schema is applied from drizzle/.
export const schema = {
  users: "Telegram identities allowed to use Maxpro",
  records: "Tasks, projects, notes, finances, habits, schedule and settings as typed JSON records",
  attachments: "File metadata; bytes are stored in the FILES R2 bucket",
} as const;
