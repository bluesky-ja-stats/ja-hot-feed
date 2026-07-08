import { AtUri } from '@atproto/syntax'
import { IngesterEvent } from 'atingester'
import { CID } from 'multiformats/cid'
import { BlobRef, JsonBlobRef } from '@atproto/lexicon'
import { ids, lexicons } from './lexicon/lexicons'
import { Record as PostRecord } from './lexicon/types/app/bsky/feed/post'
import { Record as RepostRecord } from './lexicon/types/app/bsky/feed/repost'
import { Record as LikeRecord } from './lexicon/types/app/bsky/feed/like'
import type { AppContext } from './util/config'

let i = 0
export const handleEvent = async (evt: IngesterEvent, ctx: AppContext): Promise<void> => {
  i++
  if ('time_us' in evt && i % 20 === 0) {
    await updateCursor(evt.time_us, ctx)
  } else if ('seq' in evt && evt.seq % 20 === 0) {
    await updateCursor(evt.seq, ctx)
  }

  if (evt.event === 'create') {
    if (evt.collection === ids.AppBskyFeedPost && isPost(evt.record)) {
      if (isJa(evt.record)) {
        ctx.logger.debug(`->cache   ja    post  : ${evt.time}`)
        await ctx.db
          .insertInto('post')
          .values({
            score: 0,
            uri: evt.uri.toString(),
            indexedAt: new Date().toISOString(),
          })
          .onConflict((oc) => oc.doNothing())
          .execute()
      } else {
        ctx.logger.debug(`->cache   other post  : ${evt.time}`)
        await ctx.db
          .insertInto('other_post')
          .values({
            uri: evt.uri.toString(),
            indexedAt: new Date().toISOString(),
          })
          .onConflict((oc) => oc
            .column('uri')
            .doUpdateSet({
              indexedAt: (eb) => eb.ref('excluded.indexedAt')
            })
          )
          .execute()
      }
      if (evt.record.embed && 'record' in evt.record.embed && evt.record.embed.record) {
        const subjectUri = 'uri' in evt.record.embed.record ? evt.record.embed.record.uri : evt.record.embed.record.record.uri
        await createReaction(ctx, evt, subjectUri, 'quote')
      }
    } else if (evt.collection === ids.AppBskyFeedRepost && isRepost(evt.record)) {
      await createReaction(ctx, evt, evt.record.subject.uri, 'repost')
    } else if (evt.collection === ids.AppBskyFeedLike && isLike(evt.record)) {
      await createReaction(ctx, evt, evt.record.subject.uri, 'like')
    }
  }

  if (evt.event === 'update') {} // updates not supported yet

  if (evt.event === 'delete') {
    if (evt.collection === ids.AppBskyFeedPost) {
      await ctx.db
        .deleteFrom('post')
        .where('uri', '=', evt.uri.toString())
        .execute()
      await ctx.db
        .deleteFrom('other_post')
        .where('uri', '=', evt.uri.toString())
        .execute()
      await ctx.db
        .deleteFrom('reaction')
        .where('subject', '=', evt.uri.toString())
        .execute()
      await deleteReaction(ctx, evt, 'quote')
    } else if (evt.collection === ids.AppBskyFeedRepost) {
      await deleteReaction(ctx, evt, 'repost')
    } else if (evt.collection === ids.AppBskyFeedLike) {
      await deleteReaction(ctx, evt, 'like')
    }
  }
}

const createReaction = async (ctx: AppContext, evt: IngesterEvent, subjectUri: string, type: 'like' | 'repost' | 'quote'): Promise<void> => {
  if (evt.event !== 'create') return
  if (new AtUri(subjectUri).collection !== ids.AppBskyFeedPost) return
  const score = type === 'like' ? 1 : 4
  const jaPost = await ctx.db
    .selectFrom('post')
    .selectAll()
    .where('uri', '=', subjectUri)
    .executeTakeFirst()
  const otherPost = await ctx.db
    .selectFrom('other_post')
    .selectAll()
    .where('uri', '=', subjectUri)
    .executeTakeFirst()
  if (jaPost) {
    ctx.logger.debug(`  cache-> ja    ${type.padEnd(6)}: ${evt.time}`)
    await ctx.db
      .insertInto('reaction')
      .values({
        uri: evt.uri.toString(),
        type,
        subject: subjectUri,
        indexedAt: new Date().toISOString(),
      })
      .onConflict((oc) => oc.doNothing())
      .execute()
    await ctx.db
      .insertInto('post')
      .values({
        score,
        uri: jaPost.uri,
        indexedAt: jaPost.indexedAt,
      })
      .onConflict((oc) => oc
        .column('uri')
        .doUpdateSet({
          score: (eb) => eb('score', '+', score)
        })
      )
      .execute()
  } else if (otherPost) {
    ctx.logger.debug(`  cache-> other ${type.padEnd(6)}: ${evt.time}`)
    await ctx.db
      .insertInto('other_post')
      .values({
        uri: otherPost.uri,
        indexedAt: new Date().toISOString(),
      })
      .onConflict((oc) => oc
        .column('uri')
        .doUpdateSet({
          indexedAt: (eb) => eb.ref('excluded.indexedAt')
        })
      )
      .execute()
  } else {
    ctx.logger.debug(`->queue         ${type.padEnd(6)}: ${evt.time}`)
    await ctx.db
      .insertInto('reaction_queue')
      .values({
        uri: evt.uri.toString(),
        type,
        subject: subjectUri,
        indexedAt: new Date().toISOString(),
      })
      .onConflict((oc) => oc.doNothing())
      .execute()
  }
}

const deleteReaction = async (ctx: AppContext, evt: IngesterEvent, type: 'like' | 'repost' | 'quote'): Promise<void> => {
  if (evt.event !== 'delete') return
  const score = type === 'like' ? 1 : 4
  const reaction = await ctx.db
    .selectFrom('reaction')
    .selectAll()
    .where('uri', '=', evt.uri.toString())
    .executeTakeFirst()
  if (!reaction) return
  await ctx.db
    .deleteFrom('reaction')
    .where('uri', '=', evt.uri.toString())
    .execute()
  await ctx.db
    .insertInto('post')
    .values({
      score: 0,
      uri: reaction.subject,
      indexedAt: new Date().toISOString(),
    })
    .onConflict((oc) => oc
      .column('uri')
      .doUpdateSet({
        score: (eb) => eb('score', '-', score)
      })
    )
    .execute()
}

const updateCursor = async (cursor: number, ctx: AppContext) => {
  await ctx.db
    .insertInto('sub_state')
    .values({
      service: `${ctx.cfg.subscription.mode}:${ctx.cfg.subscription[ctx.cfg.subscription.mode.toLowerCase()].service}`,
      cursor,
    })
    .onConflict((oc) => oc
      .column('service')
      .where('service', '=', `${ctx.cfg.subscription.mode}:${ctx.cfg.subscription[ctx.cfg.subscription.mode.toLowerCase()].service}`)
      .doUpdateSet({
        cursor: (eb) => eb.ref('excluded.cursor')
      })
    )
    .execute()
}

export const isJa = (record: unknown): boolean => {
  if (record && typeof record === 'object') {
    let searchtext: string = ''
    if ('text' in record) searchtext += `${record.text}\n`
    if ('embed' in record && record.embed && typeof record.embed === 'object') {
      if ('images' in record.embed && Array.isArray(record.embed.images)) {
        for (const image of record.embed.images) searchtext += `${image.alt}\n`
      }
      if ('items' in record.embed && Array.isArray(record.embed.items)) {
        for (const item of record.embed.items) searchtext += `${item.alt}\n`
      }
      if ('media' in record.embed && record.embed.media && typeof record.embed.media === 'object' && 'images' in record.embed.media && Array.isArray(record.embed.media.images)) {
        for (const image of record.embed.media.images) searchtext += `${image.alt}\n`
      }
      if ('alt' in record.embed) searchtext += `${record.embed.alt}\n`
    }
    if (('langs' in record && Array.isArray(record.langs) && record.langs.includes('ja')) || searchtext.match(/^.*[ぁ-んァ-ヶｱ-ﾝﾞﾟー]+.*$/)) {
      return true
    }
  }
  return false
}

export const isPost = (obj: unknown): obj is PostRecord => {
  return isType(obj, ids.AppBskyFeedPost)
}

export const isRepost = (obj: unknown): obj is RepostRecord => {
  return isType(obj, ids.AppBskyFeedRepost)
}

export const isLike = (obj: unknown): obj is LikeRecord => {
  return isType(obj, ids.AppBskyFeedLike)
}

const isType = (obj: unknown, nsid: string) => {
  try {
    lexicons.assertValidRecord(nsid, fixBlobRefs(obj))
    return true
  } catch (err) {
    return false
  }
}

// @TODO right now record validation fails on BlobRefs
// simply because multiple packages have their own copy
// of the BlobRef class, causing instanceof checks to fail.
// This is a temporary solution.
const fixBlobRefs = (obj: unknown): unknown => {
  if (Array.isArray(obj)) {
    return obj.map(fixBlobRefs)
  }
  if (obj && typeof obj === 'object') {
    if (obj.constructor.name === 'BlobRef') {
      const blob = obj as BlobRef
      return new BlobRef(blob.ref, blob.mimeType, blob.size, blob.original)
    }
    if ('$type' in obj && obj.$type === 'blob') {
      if ('ref' in obj && obj.ref && typeof obj.ref === 'object' && '$link' in obj.ref && typeof obj.ref.$link === 'string') {
        obj.ref = CID.parse(obj.ref.$link)
      }
      const json = obj as JsonBlobRef
      return BlobRef.fromJsonRef(json)
    }
    return Object.entries(obj).reduce((acc, [key, val]) => {
      return Object.assign(acc, { [key]: fixBlobRefs(val) })
    }, {} as Record<string, unknown>)
  }
  return obj
}
