export type DatabaseSchema = {
  post: Post
  other_post: OtherPost
  reaction: Reaction
  reaction_queue: Reaction
  sub_state: SubState
}

export type Post = {
  score: number
  uri: string
  indexedAt: string
}

export type OtherPost = {
  uri: string
  indexedAt: string
}

export type Reaction = {
  uri: string
  type: 'like' | 'repost' | 'quote'
  subject: string
  indexedAt: string
}

export type SubState = {
  service: string
  cursor: number
}
