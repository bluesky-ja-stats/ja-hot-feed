import { Agent, type AppBskyFeedGetPosts, CredentialSession } from '@atproto/api'
import { XRPCError } from '@atproto/xrpc'
import type { OtherPost, Post, Reaction } from './db/schema'
import { isJa } from './subscription'
import type { AppContext } from './util/config'
import { type Logger } from './util/logger'

const agent = new Agent(new CredentialSession(new URL('https://api.bsky.app')))
const maxDeleteSize = 32766
const maxInsertSize = 4096

let count = 0
export const updateScore = async (ctx: AppContext) => {
  count++
  const newCount = count
  ctx.logger.debug(`${newCount}: Starting job...`)
  const queuedReactions = await ctx.db
    .selectFrom('reaction_queue')
    .selectAll()
    .execute()
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
    const updates: {
      reactions: Reaction[]
      posts: Post[]
      otherPosts: OtherPost[]
    } = {
      reactions: [],
      posts: [],
      otherPosts: [],
    }
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
            updates.reactions.push(reaction)
            updates.posts.push({
              score,
              uri: subjectPost.uri,
              indexedAt: subjectPost.indexedAt,
            })
          }
        } else {
          updates.otherPosts.push({
            uri: subjectPost.uri,
            indexedAt: new Date().toISOString(),
          })
          const reactions = queuedReactions.filter(x => x.subject === subjectPost.uri)
          for (const reaction of reactions) {
            ctx.logger.debug(`->cache   other ${reaction.type.padEnd(6)}: ${reaction.indexedAt} -> ${subjectPost.indexedAt}${subjectPost.indexedAt <= new Date(new Date().getTime() - ctx.cfg.subscription.postCacheExpirationDelay).toISOString() ? '' : '(tmp)'}`)
          }
        }
      }
    }
    for (const sepValues of updates.reactions.flatMap((_, i, a) => i % maxInsertSize ? [] : [a.slice(i, i + maxInsertSize)])) {
      await ctx.db
        .insertInto('reaction')
        .values(sepValues)
        .onConflict((oc) => oc.doNothing())
        .execute()
    }
    for (const sepValues of updates.posts.flatMap((_, i, a) => i % maxInsertSize ? [] : [a.slice(i, i + maxInsertSize)])) {
      await ctx.db
        .insertInto('post')
        .values(sepValues)
        .onConflict((oc) => oc
          .column('uri')
          .doUpdateSet({
            score: (eb) => eb('score', '+', eb.ref('excluded.score'))
          })
        )
        .execute()
    }
    for (const sepValues of updates.otherPosts.flatMap((_, i, a) => i % maxInsertSize ? [] : [a.slice(i, i + maxInsertSize)])) {
      await ctx.db
        .insertInto('other_post')
        .values(sepValues)
        .onConflict((oc) => oc.doNothing())
        .execute()
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
  for (const sepDeletes of expiraedReactions.map(x => x.uri).flatMap((_, i, a) => i % maxDeleteSize ? [] : [a.slice(i, i + maxDeleteSize)])) {
    await ctx.db
      .deleteFrom('reaction')
      .where('uri', 'in', sepDeletes)
      .execute()
  }
  const updates: {
    posts: Post[]
  } = {
    posts: [],
  }
  for (const expiraedReaction of expiraedReactions) {
    const score = expiraedReaction.type === 'like' ? -1 : -4
    updates.posts.push({
      score,
      uri: expiraedReaction.subject,
      indexedAt: new Date().toISOString(),
    })
  }
  for (const sepValues of updates.posts.flatMap((_, i, a) => i % maxInsertSize ? [] : [a.slice(i, i + maxInsertSize)])) {
    await ctx.db
      .insertInto('post')
      .values(sepValues)
      .onConflict((oc) => oc
        .column('uri')
        .doUpdateSet({
          score: (eb) => eb('score', '+', eb.ref('excluded.score'))
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

export const cleanScore = async (ctx: AppContext) => {
  ctx.logger.debug(`Starting job...`)
  const posts = (await ctx.db
    .selectFrom('post')
    .selectAll()
    .execute())
    .map(x => ({...x, score: 0}))
  const reactions = await ctx.db
    .selectFrom('reaction')
    .selectAll()
    .execute()
  for (const reaction of reactions) {
    const score = reaction.type === 'like' ? 1 : 4
    const post = posts.find(p => p.uri === reaction.subject)
    if (post) {
      post.score += score
      posts[posts.findIndex(p => p.uri === reaction.subject)] = post
    }
  }
  for (const sepValues of posts.flatMap((_, i, a) => i % maxInsertSize ? [] : [a.slice(i, i + maxInsertSize)])) {
    await ctx.db
      .insertInto('post')
      .values(sepValues)
      .onConflict((oc) => oc
        .column('uri')
        .doUpdateSet({
          score: (eb) => eb.ref('excluded.score')
        })
      )
      .execute()
  }
  ctx.logger.debug(`Job has done!`)
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
