import { AtUri } from '@atproto/syntax'
import algos from '../algos'
import { Server } from '../lexicon'
import { ids } from '../lexicon/lexicons'
import { AppContext } from '../util/config'

export default function (server: Server, ctx: AppContext) {
  server.app.bsky.feed.describeFeedGenerator(async () => {
    const feeds = Object.keys(algos).map((shortname) => ({
      uri: AtUri.make(
        ctx.cfg.publisher.did,
        ids.AppBskyFeedGenerator,
        shortname,
      ).toString(),
    }))
    return {
      encoding: 'application/json',
      body: {
        did: ctx.cfg.service.did,
        feeds,
      },
    }
  })
}
