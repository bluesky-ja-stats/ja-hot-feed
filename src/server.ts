import { Ingester } from 'atingester'
import events from 'events'
import express from 'express'
import http from 'http'
import { IdResolver } from '@atproto/identity'
import { createDb, migrateToLatest } from './db'
import { createServer } from './lexicon'
import { ids } from './lexicon/lexicons'
import describeGenerator from './methods/describe-generator'
import feedGeneration from './methods/feed-generation'
import { handleEvent } from './subscription'
import type { AppContext, FeedGeneratorConfig } from './util/config'
import { createLogger } from './util/logger'
import wellKnown from './well-known'

export class FeedGenerator {
  public app: express.Application
  public server?: http.Server
  public ctx: AppContext
  public ingester: Ingester

  constructor(
    app: express.Application,
    ctx: AppContext,
    ingester: Ingester
  ) {
    this.app = app
    this.ctx = ctx
    this.ingester = ingester
  }

  static async create(
    cfg: FeedGeneratorConfig
  ) {
    const logger = createLogger(['Runner', 'Server'])
    logger.info('Creating server...')

    logger.info(`Creating DB => ${cfg.db.dbLoc}`)
    const db = createDb(cfg.db.dbLoc)

    const app = express()
    const idResolver = new IdResolver()

    const ctx: AppContext = {
      cfg,
      db,
      didResolver: idResolver.did,
      logger,
    }

    const ingesterLogger = createLogger(['Runner', 'Server', 'Ingester'])
    const ingester = new Ingester(cfg.subscription.mode, {
      idResolver,
      handleEvent: async (evt) => await handleEvent(evt, {...ctx, logger: ingesterLogger}),
      onInfo: ingesterLogger.info,
      onError: (err: Error) => ingesterLogger.error(err.message),
      getCursor: async () => {
        const res = await db
          .selectFrom('sub_state')
          .selectAll()
          .where('service', '=', `${cfg.subscription.mode}:${cfg.subscription[cfg.subscription.mode.toLowerCase()].service}`)
          .executeTakeFirst()
        return res?.cursor
      },
      service: cfg.subscription[cfg.subscription.mode.toLowerCase()].service,
      subscriptionReconnectDelay: cfg.subscription.reconnectDelay,
      unauthenticatedCommits: false,
      unauthenticatedHandles: false,
      compress: true,
      filterCollections: [ids.AppBskyFeedPost, ids.AppBskyFeedRepost, ids.AppBskyFeedLike],
      excludeIdentity: true,
      excludeAccount: true,
      excludeCommit: false,
      excludeSync: true,
    })

    const server = createServer({
      validateResponse: true,
      payload: {
        jsonLimit: 100 * 1024, // 100kb
        textLimit: 100 * 1024, // 100kb
        blobLimit: 5 * 1024 * 1024, // 5mb
      },
    })
    feedGeneration(server, ctx)
    describeGenerator(server, ctx)
    app.use(server.xrpc.router)
    app.use(wellKnown(ctx))
    
    logger.info('Server has been created!')

    return new FeedGenerator(app, ctx, ingester)
  }

  async start() {
    this.ctx.logger.info('Starting server...')
    await migrateToLatest(this.ctx.db)
    this.ingester.start()
    this.server = this.app.listen(this.ctx.cfg.service.port)
    await events.once(this.server, 'listening')
    this.ctx.logger.info('Server started')
  }

  async stop() {
    this.ctx.logger.info('Stopping server...')
    await this.ingester.destroy()
    return new Promise<void>((resolve) => {
      this.server?.close(() => {
        this.ctx.logger.info('Server stopped')
        resolve()
      })
    })
  }
}

export default FeedGenerator
