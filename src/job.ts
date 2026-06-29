import type { AppContext } from './util/config'

export const updateScore = async (ctx: AppContext) => {
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
          indexedAt: new Date().toISOString(),
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
          indexedAt: new Date().toISOString(),
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
    .where('indexedAt', '<=', new Date(new Date().getTime() - 86400000).toISOString())
    .where('score', '<=', 0)
    .execute()
  await ctx.db
    .deleteFrom('other_post')
    .where('indexedAt', '<=', new Date(new Date().getTime() - 86400000).toISOString())
    .execute()
}
