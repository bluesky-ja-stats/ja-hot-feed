import {
  type QueryParams,
  type OutputSchema as AlgoOutput,
} from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import type { AppContext } from '../util/config'
import * as whatsAlf from './whats-alf'

type AlgoHandler = (ctx: AppContext, params: QueryParams) => Promise<AlgoOutput>

const algos: Record<string, AlgoHandler> = {
  [whatsAlf.shortname]: whatsAlf.handler,
}

export default algos
