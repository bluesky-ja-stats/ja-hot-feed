import { IngesterEvent } from 'atingester'
import { CID } from 'multiformats/cid'
import { BlobRef, JsonBlobRef } from '@atproto/lexicon'
import { ids, lexicons } from './lexicon/lexicons'
import { Record as PostRecord } from './lexicon/types/app/bsky/feed/post'
import { Record as RepostRecord } from './lexicon/types/app/bsky/feed/repost'
import { Record as LikeRecord } from './lexicon/types/app/bsky/feed/like'
import { Record as FollowRecord } from './lexicon/types/app/bsky/graph/follow'
import type { AppContext } from './util/config'

let i = 0
export const handleEvent = async (evt: IngesterEvent, ctx: AppContext): Promise<void> => {
  i++
  if ('time_us' in evt && i % 20 === 0) {
    await updateCursor(evt.time_us, ctx)
  } else if ('seq' in evt && evt.seq % 20 === 0) {
    await updateCursor(evt.seq, ctx)
  }

  // This logs the text of every post off the firehose.
  // Just for fun :)
  // Delete before actually using
  if (evt.event === 'create') {
    if (evt.collection === ids.AppBskyFeedPost && isPost(evt.record)) {
      console.log(evt.record.text)
    }
  }

  if (evt.event === 'create') {
    if (evt.collection === ids.AppBskyFeedPost && isPost(evt.record)) {
      if (evt.record.text.toLowerCase().includes('alf')) {
        await ctx.db
          .insertInto('post')
          .values({
            uri: evt.uri.toString(),
            cid: evt.cid.toString(),
            indexedAt: new Date().toISOString(),
          })
          .onConflict((oc) => oc.doNothing())
          .execute()
      }
    } else if (evt.collection === ids.AppBskyFeedRepost && isRepost(evt.record)) {
    } else if (evt.collection === ids.AppBskyFeedLike && isLike(evt.record)) {
    } else if (evt.collection === ids.AppBskyGraphFollow && isFollow(evt.record)) {
    }
  }

  if (evt.event === 'update') {} // updates not supported yet

  if (evt.event === 'delete') {
    if (evt.collection === ids.AppBskyFeedPost) {
      await ctx.db
        .deleteFrom('post')
        .where('uri', '=', evt.uri.toString())
        .execute()
    } else if (evt.collection === ids.AppBskyFeedRepost) {
    } else if (evt.collection === ids.AppBskyFeedLike) {
    } else if (evt.collection === ids.AppBskyGraphFollow) {
    }
  }
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

export const isPost = (obj: unknown): obj is PostRecord => {
  return isType(obj, ids.AppBskyFeedPost)
}

export const isRepost = (obj: unknown): obj is RepostRecord => {
  return isType(obj, ids.AppBskyFeedRepost)
}

export const isLike = (obj: unknown): obj is LikeRecord => {
  return isType(obj, ids.AppBskyFeedLike)
}

export const isFollow = (obj: unknown): obj is FollowRecord => {
  return isType(obj, ids.AppBskyGraphFollow)
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
