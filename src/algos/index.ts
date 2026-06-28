import {
  type QueryParams,
  type OutputSchema as AlgoOutput,
} from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import type { AppContext } from '../util/config'
import * as jaHot from './ja-hot'

type AlgoHandler = (ctx: AppContext, params: QueryParams) => Promise<AlgoOutput>

const algos: Record<string, AlgoHandler> = {
  [jaHot.shortname]: jaHot.handler,
}

export default algos
