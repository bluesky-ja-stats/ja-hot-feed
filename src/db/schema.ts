export type DatabaseSchema = {
  post: Post
  reaction: Reaction
  sub_state: SubState
}

export type Post = {
  score: number
  uri: string
}

export type Reaction = {
  uri: string
  type: 'like' | 'repost'
  subject: string
  indexedAt: string
}

export type SubState = {
  service: string
  cursor: number
}
