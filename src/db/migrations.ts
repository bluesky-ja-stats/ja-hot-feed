import { Kysely } from 'kysely'
import { type Migration, type MigrationProvider } from 'kysely/migration'

const migrations: Record<string, Migration> = {}

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations
  },
}

migrations['001'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('post')
      .addColumn('score', 'integer', (col) => col.notNull())
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('indexedAt', 'varchar', (col) => col.notNull())
      .execute()
    await db.schema
      .createTable('other_post')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('indexedAt', 'varchar', (col) => col.notNull())
      .execute()
    await db.schema
      .createTable('reaction')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('type', 'varchar', (col) => col.notNull())
      .addColumn('subject', 'varchar', (col) => col.notNull())
      .addColumn('indexedAt', 'varchar', (col) => col.notNull())
      .execute()
    await db.schema
        .createTable('reaction_queue')
        .addColumn('uri', 'varchar', (col) => col.primaryKey())
        .addColumn('type', 'varchar', (col) => col.notNull())
        .addColumn('subject', 'varchar', (col) => col.notNull())
        .addColumn('indexedAt', 'varchar', (col) => col.notNull())
        .execute()
    await db.schema
      .createTable('sub_state')
      .addColumn('service', 'varchar', (col) => col.primaryKey())
      .addColumn('cursor', 'integer', (col) => col.notNull())
      .execute()
    await db.schema
      .createIndex('idx_post_score')
      .on('post')
      .column('score')
      .execute()
    await db.schema
      .createIndex('idx_post_uri')
      .on('post')
      .column('uri')
      .execute()
    await db.schema
      .createIndex('idx_post_indexedAt_score')
      .on('post')
      .column('indexedAt')
      .column('score')
      .execute()
    await db.schema
      .createIndex('idx_other_post_uri')
      .on('other_post')
      .column('uri')
      .execute()
    await db.schema
      .createIndex('idx_other_post_indexedAt')
      .on('other_post')
      .column('indexedAt')
      .execute()
    await db.schema
      .createIndex('idx_reaction_uri')
      .on('reaction')
      .column('uri')
      .execute()
    await db.schema
      .createIndex('idx_reaction_indexedAt')
      .on('reaction')
      .column('indexedAt')
      .execute()
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('post').execute()
    await db.schema.dropTable('other_post').execute()
    await db.schema.dropTable('reaction').execute()
    await db.schema.dropTable('reaction_queue').execute()
    await db.schema.dropTable('sub_state').execute()
    await db.schema.dropIndex('idx_post_score').execute()
    await db.schema.dropIndex('idx_post_uri').execute()
    await db.schema.dropIndex('idx_post_indexedAt_score').execute()
    await db.schema.dropIndex('idx_other_post_uri').execute()
    await db.schema.dropIndex('idx_other_post_indexedAt').execute()
    await db.schema.dropIndex('idx_reaction_uri').execute()
    await db.schema.dropIndex('idx_reaction_indexedAt').execute()
  },
}
