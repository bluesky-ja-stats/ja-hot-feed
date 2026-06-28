import algos from '../algos'
import { validateAuth } from '../auth'
import { Server } from '../lexicon'
import { ids } from '../lexicon/lexicons'
import type { AppContext } from '../util/config'
import { AtUri } from '@atproto/syntax'
import { InvalidRequestError } from '@atproto/xrpc-server'

export default function (server: Server, ctx: AppContext) {
  server.app.bsky.feed.getFeedSkeleton(async ({ params, req }) => {
    const feedUri = new AtUri(params.feed)
    const algo = algos[feedUri.rkey]
    if (
      feedUri.hostname !== ctx.cfg.publisher.did ||
      feedUri.collection !== ids.AppBskyFeedGenerator ||
      !algo
    ) {
      throw new InvalidRequestError(
        'Unsupported algorithm',
        'UnsupportedAlgorithm',
      )
    }
    /**
     * Example of how to check auth if giving user-specific results:
     *
     * const requesterDid = await validateAuth(
     *   req,
     *   ctx.cfg.service.did,
     *   ctx.didResolver,
     * )
     */

    const body = await algo(ctx, params)
    return {
      encoding: 'application/json',
      body: body,
    }
  })
}
