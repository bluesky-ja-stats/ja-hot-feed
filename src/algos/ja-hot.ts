import { type SkeletonFeedPost } from '../lexicon/types/app/bsky/feed/defs'
import { type OutputSchema, type QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import type { AppContext } from '../util/config'

export const shortname = 'ja-hot'

export const handler = async (ctx: AppContext, params: QueryParams): Promise<OutputSchema> => {
  const paramCursor = parseInt(params.cursor ?? '0')
  const res = await ctx.db
    .selectFrom('post')
    .selectAll()
    .orderBy('score', 'desc')
    .limit(params.limit)
    .offset(paramCursor)
    .execute()

  const feed: SkeletonFeedPost[] = res.map((row) => ({
    post: row.uri,
  }))

  let cursor: string | undefined
  const last = res.at(-1)
  if (last) {
    cursor = (paramCursor + params.limit).toString(10)
  }

  return {
    cursor,
    feed,
  }
}
