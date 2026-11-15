import { db } from './index.ts';
import { users } from './schema.ts';
import { eq } from 'drizzle-orm';

export async function getOrCreateUser(uid: string, email: string, name?: string) {
  try {
    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0 && existing[0].uid !== uid) {
      const updated = await db
        .update(users)
        .set({ uid, name: name || existing[0].name })
        .where(eq(users.id, existing[0].id))
        .returning();
      return updated[0];
    }

    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        name: name || email.split('@')[0],
        role: 'admin',
        allowedUnitIds: [1, 2, 3, 4, 5, 6, 7],
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          ...(name ? { name } : {}),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query failed in getOrCreateUser:', error);
    throw new Error('Falha ao sincronizar usuário no banco de dados.', { cause: error });
  }
}
