export type DatabaseSchema = {
  post: Post
  other_post: OtherPost
  reaction: Reaction
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
  type: 'like' | 'repost'
  subject: string
  indexedAt: string
}

export type SubState = {
  service: string
  cursor: number
}
