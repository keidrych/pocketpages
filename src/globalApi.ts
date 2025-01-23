import { forEach, keys, merge, values } from '@s-libs/micro-dash'
import * as log from 'pocketbase-log'
import { stringify } from 'pocketbase-stringify'
import { PagesGlobalApi } from 'src/lib/types'

export const globalApi: PagesGlobalApi = {
  stringify,
  forEach,
  keys,
  values,
  merge,
  ...log,
}
