import { Agent, type AppBskyFeedGetPosts, CredentialSession } from '@atproto/api'
import { XRPCError } from '@atproto/xrpc'
import { IngesterEvent } from 'atingester'
import { CID } from 'multiformats/cid'
import { BlobRef, JsonBlobRef } from '@atproto/lexicon'
import { ids, lexicons } from './lexicon/lexicons'
import { Record as PostRecord } from './lexicon/types/app/bsky/feed/post'
import { Record as RepostRecord } from './lexicon/types/app/bsky/feed/repost'
import { Record as LikeRecord } from './lexicon/types/app/bsky/feed/like'
import type { AppContext } from './util/config'
import { type Logger } from './util/logger'

const agent = new Agent(new CredentialSession(new URL('https://api.bsky.app')))

let i = 0
export const handleEvent = async (evt: IngesterEvent, ctx: AppContext): Promise<void> => {
  i++
  if ('time_us' in evt && i % 20 === 0) {
    await updateCursor(evt.time_us, ctx)
  } else if ('seq' in evt && evt.seq % 20 === 0) {
    await updateCursor(evt.seq, ctx)
  }
  if ('time_us' in evt && i % 100 === 0) {
    await updateScore(ctx)
  } else if ('seq' in evt && evt.seq % 100 === 0) {
    await updateScore(ctx)
  }

  if (evt.event === 'create') {
    if (evt.collection === ids.AppBskyFeedRepost && isRepost(evt.record)) {
      const [subjectPost] = await getAllPosts(agent, ctx.logger, [evt.record.subject.uri])
      if (isJa(subjectPost.record)) {
        await ctx.db
          .insertInto('reaction')
          .values({
            uri: evt.uri.toString(),
            type: 'repost',
            subject: evt.record.subject.uri,
            indexedAt: new Date().toISOString(),
          })
          .onConflict((oc) => oc.doNothing())
          .execute()
        await ctx.db
          .insertInto('post')
          .values({
            score: 4,
            uri: subjectPost.uri,
          })
          .onConflict((oc) => oc
            .column('uri')
            .doUpdateSet({
              score: (eb) => eb('score', '+', 4)
            })
          )
          .execute()
      }
    } else if (evt.collection === ids.AppBskyFeedLike && isLike(evt.record)) {
      const [subjectPost] = await getAllPosts(agent, ctx.logger, [evt.record.subject.uri])
      if (isJa(subjectPost.record)) {
        await ctx.db
          .insertInto('reaction')
          .values({
            uri: evt.uri.toString(),
            type: 'like',
            subject: evt.record.subject.uri,
            indexedAt: new Date().toISOString(),
          })
          .onConflict((oc) => oc.doNothing())
          .execute()
        await ctx.db
          .insertInto('post')
          .values({
            score: 1,
            uri: subjectPost.uri,
          })
          .onConflict((oc) => oc
            .column('uri')
            .doUpdateSet({
              score: (eb) => eb('score', '+', 1)
            })
          )
          .execute()
      }
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
        .deleteFrom('reaction')
        .where('subject', '=', evt.uri.toString())
        .execute()
    } else if (evt.collection === ids.AppBskyFeedRepost) {
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
        })
        .onConflict((oc) => oc
          .column('uri')
          .doUpdateSet({
            score: (eb) => eb('score', '-', 4)
          })
        )
        .execute()
    } else if (evt.collection === ids.AppBskyFeedLike) {
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
        })
        .onConflict((oc) => oc
          .column('uri')
          .doUpdateSet({
            score: (eb) => eb('score', '-', 1)
          })
        )
        .execute()
    }
  }
}

const updateScore = async (ctx: AppContext) => {
  const expiraedReactions = await ctx.db
    .selectFrom('reaction')
    .selectAll()
    .where('indexedAt', '<=', new Date(new Date().getTime() - ctx.cfg.subscription.reactionExpirationDelay).toISOString())
    .execute()
  for (const expiraedReaction of expiraedReactions) {
    await ctx.db
      .deleteFrom('reaction')
      .where('uri', '=', expiraedReaction.uri)
      .execute()
    if (expiraedReaction.type === 'repost') {
      await ctx.db
        .insertInto('post')
        .values({
          score: 0,
          uri: expiraedReaction.subject,
        })
        .onConflict((oc) => oc
          .column('uri')
          .doUpdateSet({
            score: (eb) => eb('score', '-', 4)
          })
        )
        .execute()
    } else if (expiraedReaction.type === 'like') {
      await ctx.db
        .insertInto('post')
        .values({
          score: 0,
          uri: expiraedReaction.subject,
        })
        .onConflict((oc) => oc
          .column('uri')
          .doUpdateSet({
            score: (eb) => eb('score', '-', 1)
          })
        )
        .execute()
    }
  }
  await ctx.db
    .deleteFrom('post')
    .where('score', '<=', 0)
    .execute()
}

const updateCursor = async (cursor: number, ctx: AppContext) => {
  await ctx.db
    .insertInto('sub_state')
    .values({
      service: `${ctx.cfg.subscription.mode}:${ctx.cfg[ctx.cfg.subscription.mode.toLowerCase()].endpoint}`,
      cursor,
    })
    .onConflict((oc) => oc
      .column('service')
      .where('service', '=', `${ctx.cfg.subscription.mode}:${ctx.cfg[ctx.cfg.subscription.mode.toLowerCase()].endpoint}`)
      .doUpdateSet({
        cursor: (eb) => eb.ref('excluded.cursor')
      })
    )
    .execute()
}

const getAllPosts = async (agent: Agent, logger: Logger, uris: string[]): Promise<AppBskyFeedGetPosts.OutputSchema['posts']> => {
  const maxUriSize = 25
  const posts: AppBskyFeedGetPosts.OutputSchema['posts'] = []
  for (const sepUris of uris.flatMap((_, i, a) => i % maxUriSize ? [] : [a.slice(i, i + maxUriSize)])) {
    posts.push(...(await getPosts(agent, logger, sepUris)))
  }
  return posts
}

const getPosts = async (agent: Agent, logger: Logger, uris: string[]): Promise<AppBskyFeedGetPosts.OutputSchema['posts']> => {
  try {
    return (await agent.getPosts({uris})).data.posts
  } catch (e: unknown) {
    if (e instanceof XRPCError) {
      logger.error(`AtpAgent could not get posts. ( ${e.message.replace('Error: ', '')} ) Try again now...`)
    } else {
      logger.error(`AtpAgent could not get posts. Try again now...`)
    }
    return await getPosts(agent, logger, uris)
  }
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
