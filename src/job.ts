import { Agent, type AppBskyFeedGetPosts, CredentialSession } from '@atproto/api'
import { XRPCError } from '@atproto/xrpc'
import { isJa } from './subscription'
import type { AppContext } from './util/config'
import { type Logger } from './util/logger'

const agent = new Agent(new CredentialSession(new URL('https://api.bsky.app')))

let count = 0
export const updateScore = async (ctx: AppContext) => {
  count++
  const newCount = count
  ctx.logger.debug(`${newCount}: Starting job...`)
  const queuedReactions = await ctx.db
    .selectFrom('reaction_queue')
    .selectAll()
    .execute()
  const maxDeleteSize = 32766
  for (const sepDeletes of queuedReactions.map(x => x.uri).flatMap((_, i, a) => i % maxDeleteSize ? [] : [a.slice(i, i + maxDeleteSize)])) {
    await ctx.db
      .deleteFrom('reaction_queue')
      .where('uri', 'in', sepDeletes)
      .execute()
  }
  ctx.logger.debug(`${newCount}: queued reactions: ${queuedReactions.length}`)
  const unknownSubjectUris = [...new Set(queuedReactions.map(x => x.subject))]
  ctx.logger.debug(`${newCount}: get ${unknownSubjectUris.length} subjects`)
  const maxUriSize = 25
  const r = unknownSubjectUris.flatMap((_, i, a) => i % maxUriSize ? [] : [a.slice(i, i + maxUriSize)])
  if (r.length <= ctx.cfg.subscription.cronInterval*2) {
    let n = 0
    for (const sepUris of r) {
      n++
      const progress = `${n}/${r.length}`
      const subjectPosts = await getPosts(agent, ctx.logger, sepUris, newCount, progress)
      for (const subjectPost of subjectPosts) {
        if (isJa(subjectPost.record)) {
          const reactions = queuedReactions.filter(x => x.subject === subjectPost.uri)
          for (const reaction of reactions) {
            ctx.logger.debug(`->cache   ja    ${reaction.type.padEnd(6)}: ${reaction.indexedAt} -> ${subjectPost.indexedAt}${subjectPost.indexedAt <= new Date(new Date().getTime() - ctx.cfg.subscription.postCacheExpirationDelay).toISOString() ? '' : '(tmp)'}`)
            const score = reaction.type === 'like' ? 1 : 4
            await ctx.db
              .insertInto('reaction')
              .values(reaction)
              .onConflict((oc) => oc.doNothing())
              .execute()
            await ctx.db
              .insertInto('post')
              .values({
                score,
                uri: subjectPost.uri,
                indexedAt: subjectPost.indexedAt,
              })
              .onConflict((oc) => oc
                .column('uri')
                .doUpdateSet({
                  score: (eb) => eb('score', '+', score)
                })
              )
              .execute()
          }
        } else {
          await ctx.db
            .insertInto('other_post')
            .values({
              uri: subjectPost.uri,
              indexedAt: new Date().toISOString(),
            })
            .onConflict((oc) => oc
              .column('uri')
              .doUpdateSet({
                indexedAt: (eb) => eb.ref('excluded.indexedAt')
              })
            )
            .execute()
          const reactions = queuedReactions.filter(x => x.subject === subjectPost.uri)
          for (const reaction of reactions) {
            ctx.logger.debug(`->cache   other ${reaction.type.padEnd(6)}: ${reaction.indexedAt} -> ${subjectPost.indexedAt}${subjectPost.indexedAt <= new Date(new Date().getTime() - ctx.cfg.subscription.postCacheExpirationDelay).toISOString() ? '' : '(tmp)'}`)
          }
        }
      }
    }
  } else {
    ctx.logger.debug(`${newCount}: reaction is abandoned`)
  }
  ctx.logger.debug(`${newCount}: Updating score...`)
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
    const score = expiraedReaction.type === 'like' ? 1 : 4
    await ctx.db
      .insertInto('post')
      .values({
        score: 0,
        uri: expiraedReaction.subject,
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
  await ctx.db
    .deleteFrom('post')
    .where('indexedAt', '<=', new Date(new Date().getTime() - ctx.cfg.subscription.postCacheExpirationDelay).toISOString())
    .where('score', '<=', 0)
    .execute()
  await ctx.db
    .deleteFrom('other_post')
    .where('indexedAt', '<=', new Date(new Date().getTime() - ctx.cfg.subscription.postCacheExpirationDelay).toISOString())
    .execute()
  ctx.logger.debug(`${newCount}: Job has done!`)
}

const getPosts = async (agent: Agent, logger: Logger, uris: string[], count: number, progress: string): Promise<AppBskyFeedGetPosts.OutputSchema['posts']> => {
  try {
    logger.debug(`${count}: get ${progress}`)
    return (await agent.getPosts({uris})).data.posts
  } catch (e: unknown) {
    if (e instanceof XRPCError) {
      logger.error(`AtpAgent could not get posts. ( ${e.message} ) Try again now...`)
    } else {
      logger.error(`AtpAgent could not get posts. Try again now...`)
    }
    return await getPosts(agent, logger, uris, count, progress)
  }
}
