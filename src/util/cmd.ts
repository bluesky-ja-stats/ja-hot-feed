import fs from 'fs'
import path from 'path'
import { FeedGenerator } from "../server"
import { createLogger, Logger } from "./logger"

export const setupCmd = (server: FeedGenerator, logger: Logger) => {
  logger.info('Registering command...')
  process.stdin.on('data', async (data) => {
    const cmd = (data.toString()).split(' ').map(v => v.trim()).filter(v => v !== '')
    for (let i = cmd.length; i > 0; i--) {
      const fullPath = path.join(__dirname, `../cmds/${cmd.slice(0, i).join('/')}${path.parse(__filename).ext}`)
      if (fs.existsSync(fullPath)) {
        const event = (await import(fullPath)).default.default as (server: FeedGenerator, logger: Logger, args: string[]) => Promise<void>
        await event(server, createLogger(['Runner', 'Commander'].concat(cmd.slice(0, i))), cmd.slice(i))
        return
      }
    }
    logger.error(`command not found`)
  })
  logger.info('Commands has been registered!')
}
