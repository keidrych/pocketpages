import { forEach, keys, merge, shuffle, values } from '@s-libs/micro-dash'
import PocketBase from 'pocketbase-js-sdk-jsvm'
import * as log from 'pocketbase-log'
import { stringify } from 'pocketbase-stringify'
import { default as parse } from 'url-parse'
import { Route } from './AfterBootstrapHandler'
import { findRecordByFilter, findRecordsByFilter } from './db'
import { PagesRequest, PagesResponse } from './pages'

export type User = {
  avatar: string
  collectionId: string
  collectionName: string
  created: string
  emailVisibility: boolean
  email: string
  id: string
  name: string
  updated: string
  username: string
  verified: boolean
}

export type AuthData = {
  token: string
  record: User
}

export type PageDataLoaderFunc<TData = any> = (
  api: Omit<PagesRequestContext<TData>, 'data'>
) => object

export type MiddlewareLoaderFunc<TData = any> = (
  api: Omit<PagesRequestContext<TData>, 'data'>
) => object

export type PagesParams<T = string> = Record<string, T | null | Array<T | null>>

export type AuthOptions = {
  collection: string
}

export type CreateUserOptions = {
  sendVerificationEmail: boolean
} & AuthOptions

export type PagesGlobalContext = {
  url: (
    path: string
  ) => ReturnType<typeof parse<Record<string, string | undefined>>>
  stringify: typeof stringify
  forEach: typeof forEach
  keys: typeof keys
  values: typeof values
  merge: typeof merge
  shuffle: typeof shuffle
  env: (key: string) => string
  findRecordByFilter: typeof findRecordByFilter
  findRecordsByFilter: typeof findRecordsByFilter
  createUser: (
    email: string,
    password: string,
    options?: Partial<CreateUserOptions>
  ) => User
  createAnonymousUser: (options?: Partial<AuthOptions>) => {
    user: User
    email: string
    password: string
  }
  createPaswordlessUser: (
    email: string,
    options?: Partial<CreateUserOptions>
  ) => {
    user: User
    password: string
  }
  requestVerification: (email: string, options?: Partial<AuthOptions>) => void
  confirmVerification: (token: string, options?: Partial<AuthOptions>) => void
  pb: () => PocketBase
} & typeof log

export type ResolveOptions = {
  mode: 'raw' | 'require' | 'script' | 'style'
}

export type RedirectOptions = {
  status: number
  message: string
}

export type PagesRequestContext<TData = any> = {
  asset: (path: string) => string
  auth?: core.Record
  data?: TData
  echo: (...args: any[]) => string
  formData: Record<string, any>
  body: () => Record<string, any> | string
  meta: (key: string, value?: string) => string | undefined
  params: PagesParams
  redirect: (path: string, options?: Partial<RedirectOptions>) => void
  request: PagesRequest
  resolve: (path: string, options?: Partial<ResolveOptions>) => any
  response: PagesResponse
  slot: string
  slots: Record<string, string>
  signInWithPassword: (
    email: string,
    password: string,
    options?: Partial<AuthOptions>
  ) => AuthData
  registerWithPassword: (
    email: string,
    password: string,
    options?: Partial<CreateUserOptions>
  ) => AuthData
  signInAnonymously: (options?: Partial<AuthOptions>) => AuthData
  ) => AuthData
  signInAnonymously: (options?: AuthOptions) => AuthData
  signOut: () => void
  signInWithToken: (token: string) => void
} & PagesGlobalContext

export type PagesConfig = {
  preprocessorExts: string[]
  debug: boolean
  host: string
  boot: (globalApi: PagesGlobalContext) => void
}

export type Cache = { routes: Route[]; config: PagesConfig }
